import { z } from 'zod';

import { writeAudit } from './audit';
import { getConnectorForProvider } from './connectors/registry';
import type { ConnectorStatementLine } from './connectors/types';
import { db } from './db';
import { AppError } from './errors';
import { KYC_TIER_INFO } from './kyc/service';
import { toBigInt } from './money';
import { notify } from './notifications';
import { type ActionContext, assertPermission } from './rbac';
import type { ReportRange } from './reports/dashboards';

/**
 * Back-office services that have no home in the domain modules: manual KYC tier assignment and
 * the reconciliation of the ledger's float movements against provider statements. Both follow
 * the house rules — permission asserted here, mutation audited in the same transaction.
 */

// ---------------------------------------------------------------------------
// KYC tier assignment
// ---------------------------------------------------------------------------

export const tierAssignmentSchema = z.object({
  tier: z.enum(['TIER_0', 'TIER_1', 'TIER_2']),
  reason: z.string().trim().min(5, 'Explain the assignment (at least 5 characters)').max(500),
});

/**
 * Sets a customer's KYC tier by hand (upgrade after an offline check, or downgrade). The
 * decision and its reason are audited and the customer is notified. Requires `kyc:review`.
 */
export async function assignKycTier(
  ctx: ActionContext,
  userId: string,
  input: z.input<typeof tierAssignmentSchema>,
) {
  assertPermission(ctx, 'kyc:review');
  const data = tierAssignmentSchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const before = await tx.user.findUnique({
      where: { id: userId },
      select: { role: true, kycTier: true, kycStatus: true },
    });
    if (!before) throw new AppError('NOT_FOUND', 'User not found');
    if (before.role !== 'CUSTOMER') {
      throw new AppError('INVALID_STATE', 'KYC tiers apply to customer accounts only');
    }
    if (before.kycTier === data.tier) {
      throw new AppError('INVALID_STATE', 'The customer is already on this tier', {
        fieldErrors: { tier: ['Already assigned'] },
      });
    }
    // A verified tier implies a verified identity; dropping to tier 0 withdraws it.
    const kycStatus =
      data.tier === 'TIER_0'
        ? before.kycStatus === 'VERIFIED'
          ? 'NONE'
          : before.kycStatus
        : 'VERIFIED';
    const after = await tx.user.update({
      where: { id: userId },
      data: { kycTier: data.tier, kycStatus },
      select: { id: true, kycTier: true, kycStatus: true },
    });
    await notify(tx, {
      userId,
      type: 'kyc.tier',
      title: 'Your verification level changed',
      body: `You are now ${KYC_TIER_INFO[data.tier].label}. Your limits have been updated.`,
      href: '/app/kyc',
    });
    await writeAudit(tx, ctx, {
      action: 'kyc.tier.assign',
      resourceType: 'user',
      resourceId: userId,
      before: { kycTier: before.kycTier, kycStatus: before.kycStatus },
      after: { kycTier: after.kycTier, kycStatus: after.kycStatus, reason: data.reason },
    });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Ledger vs provider statements
// ---------------------------------------------------------------------------

export type StatementSource = 'OPERATOR' | 'RECONSTRUCTED' | 'UNAVAILABLE';
export type ReconciliationBreak = 'AMOUNT_MISMATCH' | 'LEDGER_ONLY' | 'PROVIDER_ONLY';

export interface ReconciliationLine {
  readonly reference: string;
  readonly transferId: string | null;
  readonly currency: string;
  /** Net float outflow booked in the ledger (payouts positive, collections negative). */
  readonly ledgerAmount: bigint;
  /** Net outflow according to the provider statement. */
  readonly providerAmount: bigint;
  readonly kind: ReconciliationBreak;
}

export interface ProviderReconciliation {
  readonly providerId: string;
  readonly name: string;
  readonly code: string;
  readonly currency: string;
  readonly simulated: boolean;
  /**
   * Where the provider side comes from: the operator's own statement (HTTP adapter), a
   * statement reconstructed from the outcomes the simulator acknowledged (sandbox — the
   * simulator keeps no history), or unavailable when the operator could not be reached.
   */
  readonly statementSource: StatementSource;
  readonly statementError: string | null;
  readonly references: number;
  readonly matched: number;
  readonly ledgerTotal: bigint;
  readonly providerTotal: bigint;
  readonly breaks: readonly ReconciliationLine[];
}

interface LedgerFloatRow {
  provider_id: string;
  transfer_id: string;
  reference: string;
  currency: string;
  outflow: unknown;
}

const MAX_BREAKS = 50;

/** Net outflow per reference: successful payouts minus successful collections / reversals. */
export function netStatement(lines: readonly ConnectorStatementLine[]): Map<string, bigint> {
  const net = new Map<string, bigint>();
  for (const line of lines) {
    if (line.status !== 'SUCCESS') continue;
    const signed = line.direction === 'PAYOUT' ? line.amount : -line.amount;
    net.set(line.reference, (net.get(line.reference) ?? 0n) + signed);
  }
  return net;
}

/** Compares two "net outflow per reference" maps. Pure — unit tested. */
export function compareStatements(
  ledger: ReadonlyMap<string, { amount: bigint; transferId: string | null }>,
  provider: ReadonlyMap<string, bigint>,
  currency: string,
): { matched: number; breaks: ReconciliationLine[] } {
  let matched = 0;
  const breaks: ReconciliationLine[] = [];
  for (const [reference, entry] of ledger) {
    const providerAmount = provider.get(reference);
    if (providerAmount === undefined) {
      // A fully reversed movement nets to zero and needs no provider line.
      if (entry.amount === 0n) matched += 1;
      else
        breaks.push({
          reference,
          transferId: entry.transferId,
          currency,
          ledgerAmount: entry.amount,
          providerAmount: 0n,
          kind: 'LEDGER_ONLY',
        });
    } else if (providerAmount === entry.amount) {
      matched += 1;
    } else {
      breaks.push({
        reference,
        transferId: entry.transferId,
        currency,
        ledgerAmount: entry.amount,
        providerAmount,
        kind: 'AMOUNT_MISMATCH',
      });
    }
  }
  for (const [reference, providerAmount] of provider) {
    if (ledger.has(reference) || providerAmount === 0n) continue;
    breaks.push({
      reference,
      transferId: null,
      currency,
      ledgerAmount: 0n,
      providerAmount,
      kind: 'PROVIDER_ONLY',
    });
  }
  return { matched, breaks };
}

/**
 * Statement of a simulated provider, rebuilt from the outcomes the simulator acknowledged
 * (stored on the transfers as `provider_ref` + final status). It is independent of the ledger
 * entries it is compared with, so a transfer the provider confirmed but the ledger never
 * settled — or the reverse — still shows up as a break.
 */
async function reconstructStatement(
  providerId: string,
  range: ReportRange,
): Promise<ConnectorStatementLine[]> {
  const transfers = await db.transfer.findMany({
    where: {
      providerId,
      providerRef: { not: null },
      status: { in: ['COMPLETED', 'REVERSED'] },
      createdAt: { gte: range.from, lte: range.to },
    },
    select: {
      reference: true,
      providerRef: true,
      type: true,
      status: true,
      sendAmount: true,
      receiveAmount: true,
      targetCurrency: true,
      completedAt: true,
      reversedAt: true,
      createdAt: true,
    },
  });
  const lines: ConnectorStatementLine[] = [];
  for (const transfer of transfers) {
    const collect = transfer.type === 'TOPUP';
    const line: ConnectorStatementLine = {
      providerRef: transfer.providerRef ?? '',
      reference: transfer.reference,
      direction: collect ? 'COLLECT' : 'PAYOUT',
      amount: collect ? transfer.sendAmount : transfer.receiveAmount,
      currency: transfer.targetCurrency,
      status: 'SUCCESS',
      at: transfer.completedAt ?? transfer.createdAt,
    };
    lines.push(line);
    if (transfer.status === 'REVERSED') {
      lines.push({
        ...line,
        direction: collect ? 'PAYOUT' : 'COLLECT',
        at: transfer.reversedAt ?? line.at,
      });
    }
  }
  return lines;
}

/**
 * Reconciles, per provider, the float movements booked in the ledger (entries on the
 * settlement accounts of provider transfers created in the range) against the provider's
 * statement. Requires `transfers:read`. Providers without any movement are omitted.
 */
export async function getProviderReconciliation(
  ctx: ActionContext,
  range: ReportRange,
): Promise<ProviderReconciliation[]> {
  assertPermission(ctx, 'transfers:read');
  const [rows, providers] = await Promise.all([
    db.$queryRaw<LedgerFloatRow[]>`
      SELECT t.provider_id::text AS provider_id, t.id::text AS transfer_id, t.reference, e.currency,
             SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount ELSE -e.amount END) AS outflow
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id AND a.type = 'SETTLEMENT'
      JOIN journals j ON j.id = e.journal_id
      JOIN transfers t ON t.id = j.transfer_id
      WHERE t.provider_id IS NOT NULL
        AND t.created_at >= ${range.from} AND t.created_at <= ${range.to}
      GROUP BY t.provider_id, t.id, t.reference, e.currency`,
    db.provider.findMany({
      where: { transfers: { some: { createdAt: { gte: range.from, lte: range.to } } } },
      orderBy: [{ countryCode: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, code: true, currency: true, adapter: true },
    }),
  ]);

  const result: ProviderReconciliation[] = [];
  for (const provider of providers) {
    const ledger = new Map<string, { amount: bigint; transferId: string | null }>();
    for (const row of rows) {
      if (row.provider_id !== provider.id) continue;
      ledger.set(row.reference, { amount: toBigInt(row.outflow), transferId: row.transfer_id });
    }
    const simulated = provider.adapter === 'simulator';
    let statementSource: StatementSource = simulated ? 'RECONSTRUCTED' : 'OPERATOR';
    let statementError: string | null = null;
    let lines: ConnectorStatementLine[] = [];
    try {
      if (simulated) {
        lines = await reconstructStatement(provider.id, range);
      } else {
        const { connector } = await getConnectorForProvider(provider.id, { allowInactive: true });
        lines = await connector.getStatement(range);
      }
    } catch (error) {
      statementSource = 'UNAVAILABLE';
      statementError =
        error instanceof Error ? error.message.slice(0, 200) : 'Statement not available';
    }
    const statement = netStatement(lines);
    const { matched, breaks } =
      statementSource === 'UNAVAILABLE'
        ? { matched: 0, breaks: [] }
        : compareStatements(ledger, statement, provider.currency);
    if (ledger.size === 0 && statement.size === 0 && statementSource !== 'UNAVAILABLE') continue;
    result.push({
      providerId: provider.id,
      name: provider.name,
      code: provider.code,
      currency: provider.currency,
      simulated,
      statementSource,
      statementError,
      references: new Set([...ledger.keys(), ...statement.keys()]).size,
      matched,
      ledgerTotal: [...ledger.values()].reduce((total, entry) => total + entry.amount, 0n),
      providerTotal: [...statement.values()].reduce((total, amount) => total + amount, 0n),
      breaks: breaks.slice(0, MAX_BREAKS),
    });
  }
  return result;
}
