import type { EntryDirection, JournalKind, LedgerAccountType } from '@/generated/prisma/enums';

import { type DbOrTx, type Prisma, type Tx, db } from './db';
import { AppError } from './errors';
import { currencyInfo, formatMoney, toBigInt } from './money';

/**
 * Double-entry ledger.
 *
 * - Every movement is a journal of positive DEBIT/CREDIT entries, balanced per currency.
 * - `ledger_accounts.balance` is kept in the account's natural sign: an entry on the account's
 *   `normalSide` increases it, the opposite side decreases it. Wallets are CREDIT-normal
 *   liabilities, so a credit tops a wallet up and a debit spends from it.
 * - `postJournal` locks the accounts with `SELECT … FOR UPDATE` in id order, re-reads balances
 *   under the lock, refuses to take a non-`allowNegative` account below zero and writes the
 *   journal, the entries (with `balanceAfter`) and the new balances — all inside the caller's
 *   transaction. The database double-checks: a CHECK constraint on balances and a deferred
 *   trigger that verifies every journal balances at commit.
 * - Journals and entries are append-only; corrections are new compensating journals.
 */

export interface PostingLine {
  readonly accountId: string;
  readonly direction: EntryDirection;
  /** Positive minor units in the account's currency. */
  readonly amount: bigint;
}

export interface PostJournalInput {
  readonly kind: JournalKind;
  readonly description: string;
  readonly lines: readonly PostingLine[];
  readonly transferId?: string | null;
  readonly reversesJournalId?: string | null;
  readonly createdById?: string | null;
  readonly metadata?: Prisma.InputJsonValue;
  /** Backdating for the demo seed only. */
  readonly postedAt?: Date;
}

export interface LockedAccount {
  readonly id: string;
  readonly code: string;
  readonly type: LedgerAccountType;
  readonly currency: string;
  readonly normalSide: EntryDirection;
  readonly balance: bigint;
  readonly allowNegative: boolean;
}

interface LockedAccountRow {
  id: string;
  code: string;
  type: LedgerAccountType;
  currency: string;
  normal_side: EntryDirection;
  balance: bigint;
  allow_negative: boolean;
}

/**
 * Locks ledger accounts `FOR UPDATE` in a stable (id-sorted) order and returns their current
 * state. When a transaction posts more than one journal, call this first with the union of all
 * accounts so the lock order is global and deadlock-free.
 */
export async function lockAccounts(
  tx: Tx,
  accountIds: readonly string[],
): Promise<Map<string, LockedAccount>> {
  const ids = [...new Set(accountIds)].sort();
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<LockedAccountRow[]>`
    SELECT id, code, type, currency, normal_side, balance, allow_negative
    FROM ledger_accounts
    WHERE id = ANY(${ids}::uuid[])
    ORDER BY id
    FOR UPDATE`;
  if (rows.length !== ids.length) {
    throw new AppError('NOT_FOUND', 'One or more ledger accounts do not exist');
  }
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        code: row.code,
        type: row.type,
        currency: row.currency,
        normalSide: row.normal_side,
        balance: row.balance,
        allowNegative: row.allow_negative,
      },
    ]),
  );
}

export interface PostedJournal {
  readonly journalId: string;
  /** Balance of every touched account after the journal. */
  readonly balances: ReadonlyMap<string, bigint>;
}

/**
 * Posts one balanced journal inside `tx`. Throws `INSUFFICIENT_FUNDS` if a wallet would go
 * negative and `VALIDATION` if the journal does not balance per currency.
 */
export async function postJournal(tx: Tx, input: PostJournalInput): Promise<PostedJournal> {
  if (input.lines.length < 2) {
    throw new AppError('VALIDATION', 'A journal needs at least two entries');
  }
  for (const line of input.lines) {
    if (line.amount <= 0n) throw new AppError('VALIDATION', 'Ledger entries must be positive');
  }

  const accounts = await lockAccounts(
    tx,
    input.lines.map((line) => line.accountId),
  );

  // Balance check per currency.
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const line of input.lines) {
    const account = accounts.get(line.accountId);
    if (!account) throw new AppError('NOT_FOUND', 'Ledger account not found');
    const total = totals.get(account.currency) ?? { debit: 0n, credit: 0n };
    if (line.direction === 'DEBIT') total.debit += line.amount;
    else total.credit += line.amount;
    totals.set(account.currency, total);
  }
  for (const [currency, total] of totals) {
    if (total.debit !== total.credit) {
      throw new AppError(
        'VALIDATION',
        `Journal is not balanced in ${currency}: debits ${total.debit} ≠ credits ${total.credit}`,
      );
    }
  }

  // Apply the lines in order, tracking running balances.
  const running = new Map<string, bigint>();
  const entryRows: Prisma.LedgerEntryCreateManyInput[] = [];
  const journal = await tx.journal.create({
    data: {
      kind: input.kind,
      description: input.description,
      transferId: input.transferId ?? null,
      reversesJournalId: input.reversesJournalId ?? null,
      createdById: input.createdById ?? null,
      metadata: input.metadata,
      ...(input.postedAt ? { postedAt: input.postedAt } : {}),
    },
    select: { id: true },
  });

  for (const line of input.lines) {
    const account = accounts.get(line.accountId);
    if (!account) throw new AppError('NOT_FOUND', 'Ledger account not found');
    const current = running.get(account.id) ?? account.balance;
    const next =
      line.direction === account.normalSide ? current + line.amount : current - line.amount;
    running.set(account.id, next);
    entryRows.push({
      journalId: journal.id,
      accountId: account.id,
      direction: line.direction,
      amount: line.amount,
      currency: account.currency,
      balanceAfter: next,
      ...(input.postedAt ? { createdAt: input.postedAt } : {}),
    });
  }

  for (const [accountId, balance] of running) {
    const account = accounts.get(accountId);
    if (account && !account.allowNegative && balance < 0n) {
      throw new AppError(
        'INSUFFICIENT_FUNDS',
        `Insufficient funds: ${formatMoney(account.balance, account.currency)} available`,
        {
          details: { accountId, available: account.balance.toString(), currency: account.currency },
        },
      );
    }
  }

  await tx.ledgerEntry.createMany({ data: entryRows });
  for (const [accountId, balance] of running) {
    await tx.ledgerAccount.update({ where: { id: accountId }, data: { balance } });
  }
  return { journalId: journal.id, balances: running };
}

/**
 * Posts the exact mirror of an existing journal (every entry with the opposite direction) and
 * links it through `reversesJournalId`. A journal can be reversed once (unique constraint).
 */
export async function reverseJournal(
  tx: Tx,
  journalId: string,
  options: {
    description: string;
    kind?: JournalKind;
    createdById?: string | null;
    transferId?: string | null;
    postedAt?: Date;
  },
): Promise<PostedJournal> {
  const original = await tx.journal.findUnique({
    where: { id: journalId },
    include: { entries: { orderBy: { createdAt: 'asc' } }, reversal: { select: { id: true } } },
  });
  if (!original) throw new AppError('NOT_FOUND', 'Journal not found');
  if (original.reversal) throw new AppError('INVALID_STATE', 'Journal has already been reversed');
  if (original.reversesJournalId) {
    throw new AppError('INVALID_STATE', 'A reversal journal cannot itself be reversed');
  }
  return postJournal(tx, {
    kind: options.kind ?? 'REVERSAL',
    description: options.description,
    transferId: options.transferId ?? original.transferId,
    reversesJournalId: original.id,
    createdById: options.createdById ?? null,
    postedAt: options.postedAt,
    lines: original.entries.map((entry) => ({
      accountId: entry.accountId,
      direction: entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      amount: entry.amount,
    })),
  });
}

// ---------------------------------------------------------------------------
// System accounts
// ---------------------------------------------------------------------------

export type SystemAccountType = Exclude<LedgerAccountType, 'WALLET'>;

export const SYSTEM_ACCOUNT_TYPES: readonly SystemAccountType[] = [
  'FEE_REVENUE',
  'FX_REVENUE',
  'FX_POSITION',
  'SUSPENSE',
  'SETTLEMENT',
  'COMMISSION_EXPENSE',
  'COMMISSION_PAYABLE',
  'CAPITAL',
];

const SYSTEM_ACCOUNT_META: Record<SystemAccountType, { name: string; normalSide: EntryDirection }> =
  {
    FEE_REVENUE: { name: 'Fee revenue', normalSide: 'CREDIT' },
    FX_REVENUE: { name: 'FX margin revenue', normalSide: 'CREDIT' },
    // Clearing account each cross-currency leg passes through. Positive = long (currency received
    // from senders and not yet converted), negative = short (currency paid out to recipients).
    FX_POSITION: { name: 'FX position', normalSide: 'CREDIT' },
    // Customer funds reserved for held (AML) or in-flight (provider pending) transfers.
    SUSPENSE: { name: 'Suspense (reserved funds)', normalSide: 'CREDIT' },
    // Float held with operators/banks; debited on cash-in, credited on external payouts.
    SETTLEMENT: { name: 'Settlement / float', normalSide: 'DEBIT' },
    COMMISSION_EXPENSE: { name: 'Partner commission expense', normalSide: 'DEBIT' },
    COMMISSION_PAYABLE: { name: 'Partner commission payable', normalSide: 'CREDIT' },
    // Treasury funding of the float (the other side of a float top-up or withdrawal).
    CAPITAL: { name: 'Treasury funding', normalSide: 'CREDIT' },
  };

export const systemAccountCode = (type: SystemAccountType, currency: string): string =>
  `SYS:${type}:${currency}`;

/** Creates the system accounts of a currency if missing (idempotent; used by the seed). */
export async function ensureSystemAccounts(client: DbOrTx, currency: string): Promise<void> {
  const info = currencyInfo(currency);
  for (const type of SYSTEM_ACCOUNT_TYPES) {
    const meta = SYSTEM_ACCOUNT_META[type];
    await client.ledgerAccount.upsert({
      where: { code: systemAccountCode(type, info.code) },
      create: {
        code: systemAccountCode(type, info.code),
        name: `${meta.name} — ${info.code}`,
        type,
        currency: info.code,
        normalSide: meta.normalSide,
        allowNegative: true,
      },
      update: {},
    });
  }
}

/** Id of a system account. Throws when the currency has not been set up by the seed. */
export async function getSystemAccountId(
  client: DbOrTx,
  type: SystemAccountType,
  currency: string,
): Promise<string> {
  const account = await client.ledgerAccount.findUnique({
    where: { code: systemAccountCode(type, currency) },
    select: { id: true },
  });
  if (!account) {
    throw new AppError(
      'INTERNAL',
      `System account ${systemAccountCode(type, currency)} is missing — run the seed`,
    );
  }
  return account.id;
}

/** Ids of several system accounts of one currency in one query. */
export async function getSystemAccountIds<T extends SystemAccountType>(
  client: DbOrTx,
  currency: string,
  types: readonly T[],
): Promise<Record<T, string>> {
  const codes = types.map((type) => systemAccountCode(type, currency));
  const rows = await client.ledgerAccount.findMany({
    where: { code: { in: codes } },
    select: { id: true, type: true },
  });
  const out = {} as Record<T, string>;
  for (const type of types) {
    const row = rows.find((candidate) => candidate.type === type);
    if (!row) {
      throw new AppError(
        'INTERNAL',
        `System account ${systemAccountCode(type, currency)} is missing — run the seed`,
      );
    }
    out[type] = row.id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getAccountBalance(accountId: string, client: DbOrTx = db): Promise<bigint> {
  const account = await client.ledgerAccount.findUnique({
    where: { id: accountId },
    select: { balance: true },
  });
  if (!account) throw new AppError('NOT_FOUND', 'Ledger account not found');
  return account.balance;
}

export interface StatementLine {
  readonly entryId: string;
  readonly journalId: string;
  readonly kind: JournalKind;
  readonly description: string;
  readonly transferId: string | null;
  readonly direction: EntryDirection;
  readonly amount: bigint;
  /** Signed effect on the account balance (positive = balance went up). */
  readonly delta: bigint;
  readonly balanceAfter: bigint;
  readonly currency: string;
  readonly createdAt: Date;
}

/** Entries of one account, newest first. No authorisation — callers check ownership. */
export async function getAccountStatement(
  accountId: string,
  options: { limit?: number; before?: Date } = {},
  client: DbOrTx = db,
): Promise<StatementLine[]> {
  const account = await client.ledgerAccount.findUnique({
    where: { id: accountId },
    select: { normalSide: true },
  });
  if (!account) throw new AppError('NOT_FOUND', 'Ledger account not found');
  const entries = await client.ledgerEntry.findMany({
    where: { accountId, ...(options.before ? { createdAt: { lt: options.before } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(options.limit ?? 50, 500),
    include: { journal: { select: { kind: true, description: true, transferId: true } } },
  });
  return entries.map((entry) => ({
    entryId: entry.id,
    journalId: entry.journalId,
    kind: entry.journal.kind,
    description: entry.journal.description,
    transferId: entry.journal.transferId,
    direction: entry.direction,
    amount: entry.amount,
    delta: entry.direction === account.normalSide ? entry.amount : -entry.amount,
    balanceAfter: entry.balanceAfter,
    currency: entry.currency,
    createdAt: entry.createdAt,
  }));
}

export interface CurrencyIntegrity {
  readonly currency: string;
  readonly totalDebits: bigint;
  readonly totalCredits: bigint;
  /** Journals whose entries do not balance (must be 0). */
  readonly unbalancedJournals: number;
  /** Accounts whose stored balance differs from the sum of their entries (must be 0). */
  readonly driftingAccounts: number;
  /** Wallet-type accounts below zero (must be 0). */
  readonly negativeWallets: number;
  readonly balanced: boolean;
}

interface IntegrityRow {
  currency: string;
  total_debits: bigint | null;
  total_credits: bigint | null;
}

interface CountRow {
  currency: string;
  count: bigint;
}

/**
 * Full-ledger integrity report per currency (reconciliation view, tests): debits = credits,
 * every journal balanced, stored balances equal to the entries, no negative wallet.
 */
export async function verifyLedgerIntegrity(client: DbOrTx = db): Promise<CurrencyIntegrity[]> {
  const totals = await client.$queryRaw<IntegrityRow[]>`
    SELECT currency,
           SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END) AS total_debits,
           SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END) AS total_credits
    FROM ledger_entries GROUP BY currency ORDER BY currency`;
  const unbalanced = await client.$queryRaw<CountRow[]>`
    SELECT currency, COUNT(*) AS count FROM (
      SELECT journal_id, currency
      FROM ledger_entries
      GROUP BY journal_id, currency
      HAVING SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END)
          <> SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END)
    ) bad GROUP BY currency`;
  const drifting = await client.$queryRaw<CountRow[]>`
    SELECT a.currency, COUNT(*) AS count
    FROM ledger_accounts a
    LEFT JOIN (
      SELECT e.account_id,
             SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount ELSE -e.amount END) AS net_debit
      FROM ledger_entries e GROUP BY e.account_id
    ) s ON s.account_id = a.id
    WHERE a.balance <> CASE WHEN a.normal_side = 'DEBIT'
                            THEN COALESCE(s.net_debit, 0) ELSE -COALESCE(s.net_debit, 0) END
    GROUP BY a.currency`;
  const negative = await client.$queryRaw<CountRow[]>`
    SELECT currency, COUNT(*) AS count FROM ledger_accounts
    WHERE NOT allow_negative AND balance < 0 GROUP BY currency`;

  const countFor = (rows: CountRow[], currency: string): number =>
    Number(toBigInt(rows.find((row) => row.currency === currency)?.count));
  const currencies = new Set([
    ...totals.map((row) => row.currency),
    ...drifting.map((row) => row.currency),
    ...negative.map((row) => row.currency),
  ]);
  return [...currencies].sort().map((currency) => {
    const row = totals.find((candidate) => candidate.currency === currency);
    const totalDebits = toBigInt(row?.total_debits);
    const totalCredits = toBigInt(row?.total_credits);
    const unbalancedJournals = countFor(unbalanced, currency);
    const driftingAccounts = countFor(drifting, currency);
    const negativeWallets = countFor(negative, currency);
    return {
      currency,
      totalDebits,
      totalCredits,
      unbalancedJournals,
      driftingAccounts,
      negativeWallets,
      balanced:
        totalDebits === totalCredits &&
        unbalancedJournals === 0 &&
        driftingAccounts === 0 &&
        negativeWallets === 0,
    };
  });
}
