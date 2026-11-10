import type { TransferStatus, TransferType } from '@/generated/prisma/enums';

import { db } from '../db';
import { AppError } from '../errors';
import { verifyLedgerIntegrity } from '../ledger';
import { toBigInt } from '../money';
import { type ActionContext, assertPermission } from '../rbac';
import { type LiquidityLevel, liquidityLevel } from '../treasury';

/**
 * Reporting & BI (phase 10): the five dashboards, computed live from Postgres with aggregate
 * SQL. Cross-currency figures use the USD value captured on each transfer at creation
 * (`send_amount_usd`, `revenue_usd`, USD cents at the mid rate of the day).
 *
 * All amounts are `bigint` minor units — pass results through `serialize()` before handing them
 * to Client Components.
 */

export interface ReportRange {
  readonly from: Date;
  readonly to: Date;
}

const DAY_MS = 86_400_000;

/** Builds a range from `?days=30` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive, UTC). */
export function resolveRange(
  input: { days?: number | string; from?: string; to?: string } = {},
  now: Date = new Date(),
): ReportRange {
  const isDate = (value: string | undefined): value is string =>
    value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (isDate(input.from) && isDate(input.to)) {
    const from = new Date(`${input.from}T00:00:00.000Z`);
    const to = new Date(`${input.to}T23:59:59.999Z`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
      // Cap at 366 days to keep live aggregation cheap.
      return {
        from:
          to.getTime() - from.getTime() > 366 * DAY_MS
            ? new Date(to.getTime() - 366 * DAY_MS)
            : from,
        to,
      };
    }
  }
  const parsed = Number(input.days ?? 30);
  const days = Number.isInteger(parsed) && parsed >= 1 && parsed <= 366 ? parsed : 30;
  return { from: new Date(now.getTime() - days * DAY_MS), to: now };
}

const big = toBigInt;
const num = (value: unknown): number => Number(toBigInt(value));
/** Ratio in basis points (integer), 0 when the denominator is 0. */
const ratioBps = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part * 10_000) / total);

// ---------------------------------------------------------------------------
// Executive
// ---------------------------------------------------------------------------

interface TotalsRow {
  total: bigint;
  completed: bigint;
  failed: bigint;
  on_hold: bigint;
  processing: bigint;
  reversed: bigint;
  value_usd: bigint | null;
  revenue_usd: bigint | null;
}

interface DailyRow {
  day: Date;
  count: bigint;
  completed: bigint;
  failed: bigint;
  value_usd: bigint | null;
  revenue_usd: bigint | null;
}

interface CorridorRow {
  source_country: string;
  target_country: string;
  source_currency: string;
  target_currency: string;
  count: bigint;
  value_usd: bigint | null;
  revenue_usd: bigint | null;
  fx_margin_usd: bigint | null;
}

interface CountryRow {
  country: string;
  sent: bigint;
  sent_usd: bigint | null;
}

export interface DailyPoint {
  /** `YYYY-MM-DD` (UTC). */
  readonly date: string;
  readonly count: number;
  readonly completed: number;
  readonly failed: number;
  readonly valueUsd: bigint;
  readonly revenueUsd: bigint;
}

export interface CorridorStat {
  readonly sourceCountry: string;
  readonly targetCountry: string;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly count: number;
  readonly valueUsd: bigint;
  readonly revenueUsd: bigint;
  readonly fxMarginUsd: bigint;
}

async function transferTotals(range: ReportRange) {
  const rows = await db.$queryRaw<TotalsRow[]>`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
           COUNT(*) FILTER (WHERE status IN ('FAILED', 'REJECTED')) AS failed,
           COUNT(*) FILTER (WHERE status = 'ON_HOLD') AS on_hold,
           COUNT(*) FILTER (WHERE status = 'PROCESSING') AS processing,
           COUNT(*) FILTER (WHERE status = 'REVERSED') AS reversed,
           SUM(send_amount_usd) FILTER (WHERE status = 'COMPLETED') AS value_usd,
           SUM(revenue_usd) FILTER (WHERE status = 'COMPLETED') AS revenue_usd
    FROM transfers
    WHERE type <> 'TOPUP' AND created_at >= ${range.from} AND created_at <= ${range.to}`;
  const row = rows[0];
  const total = num(row?.total);
  const failed = num(row?.failed);
  return {
    transfers: total,
    completed: num(row?.completed),
    failed,
    onHold: num(row?.on_hold),
    processing: num(row?.processing),
    reversed: num(row?.reversed),
    /** Failed + rejected as basis points of all transfers. */
    failureRateBps: ratioBps(failed, total),
    valueUsd: big(row?.value_usd),
    revenueUsd: big(row?.revenue_usd),
  };
}

async function dailySeries(range: ReportRange): Promise<DailyPoint[]> {
  const rows = await db.$queryRaw<DailyRow[]>`
    SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
           COUNT(*) AS count,
           COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
           COUNT(*) FILTER (WHERE status IN ('FAILED', 'REJECTED')) AS failed,
           SUM(send_amount_usd) FILTER (WHERE status = 'COMPLETED') AS value_usd,
           SUM(revenue_usd) FILTER (WHERE status = 'COMPLETED') AS revenue_usd
    FROM transfers
    WHERE type <> 'TOPUP' AND created_at >= ${range.from} AND created_at <= ${range.to}
    GROUP BY 1 ORDER BY 1`;
  const byDate = new Map(rows.map((row) => [row.day.toISOString().slice(0, 10), row]));
  // Fill gaps so charts have one point per day.
  const points: DailyPoint[] = [];
  const start = Date.UTC(
    range.from.getUTCFullYear(),
    range.from.getUTCMonth(),
    range.from.getUTCDate(),
  );
  for (let time = start; time <= range.to.getTime(); time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    const row = byDate.get(date);
    points.push({
      date,
      count: num(row?.count),
      completed: num(row?.completed),
      failed: num(row?.failed),
      valueUsd: big(row?.value_usd),
      revenueUsd: big(row?.revenue_usd),
    });
  }
  return points;
}

async function corridorStats(range: ReportRange, limit = 20): Promise<CorridorStat[]> {
  const rows = await db.$queryRaw<CorridorRow[]>`
    SELECT source_country, target_country, source_currency, target_currency,
           COUNT(*) AS count,
           SUM(send_amount_usd) AS value_usd,
           SUM(revenue_usd) AS revenue_usd,
           SUM(CASE WHEN fee_amount + fx_margin_amount = 0 THEN 0
                    ELSE revenue_usd * fx_margin_amount / (fee_amount + fx_margin_amount) END) AS fx_margin_usd
    FROM transfers
    WHERE type <> 'TOPUP' AND status = 'COMPLETED'
      AND created_at >= ${range.from} AND created_at <= ${range.to}
    GROUP BY 1, 2, 3, 4
    ORDER BY SUM(send_amount_usd) DESC
    LIMIT ${limit}`;
  return rows.map((row) => ({
    sourceCountry: row.source_country,
    targetCountry: row.target_country,
    sourceCurrency: row.source_currency,
    targetCurrency: row.target_currency,
    count: num(row.count),
    valueUsd: big(row.value_usd),
    revenueUsd: big(row.revenue_usd),
    fxMarginUsd: big(row.fx_margin_usd),
  }));
}

async function activeUsers(now: Date) {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await db.$queryRaw<Array<{ dau: bigint; mau: bigint }>>`
    WITH activity AS (
      SELECT user_id, created_at FROM sessions WHERE created_at >= ${monthAgo}
      UNION ALL
      SELECT sender_user_id, created_at FROM transfers
      WHERE sender_user_id IS NOT NULL AND created_at >= ${monthAgo} AND created_at <= ${now}
    )
    SELECT COUNT(DISTINCT a.user_id) FILTER (WHERE a.created_at >= ${dayAgo}) AS dau,
           COUNT(DISTINCT a.user_id) AS mau
    FROM activity a JOIN users u ON u.id = a.user_id AND u.role = 'CUSTOMER'`;
  return { dau: num(rows[0]?.dau), mau: num(rows[0]?.mau) };
}

/** Executive dashboard: headline KPIs, daily trend, top corridors, country activity. */
export async function getExecutiveDashboard(
  ctx: ActionContext,
  range: ReportRange = resolveRange(),
) {
  assertPermission(ctx, 'reports:read');
  const [totals, daily, corridors, countries, users, customers, newCustomers] = await Promise.all([
    transferTotals(range),
    dailySeries(range),
    corridorStats(range, 8),
    db.$queryRaw<CountryRow[]>`
      SELECT source_country AS country, COUNT(*) AS sent, SUM(send_amount_usd) AS sent_usd
      FROM transfers
      WHERE type <> 'TOPUP' AND status = 'COMPLETED'
        AND created_at >= ${range.from} AND created_at <= ${range.to}
      GROUP BY 1 ORDER BY SUM(send_amount_usd) DESC`,
    activeUsers(range.to),
    db.user.count({ where: { role: 'CUSTOMER' } }),
    db.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: range.from, lte: range.to } } }),
  ]);
  return {
    range,
    totals,
    activeUsers: users,
    customers: { total: customers, new: newCustomers },
    daily,
    corridors,
    countries: countries.map((row) => ({
      country: row.country,
      sent: num(row.sent),
      sentUsd: big(row.sent_usd),
    })),
  };
}

// ---------------------------------------------------------------------------
// Operational
// ---------------------------------------------------------------------------

interface ProviderPerfRow {
  provider_id: string;
  name: string;
  code: string;
  adapter: string;
  health_status: string;
  total: bigint;
  completed: bigint;
  failed: bigint;
  pending: bigint;
  avg_seconds: number | null;
  value_usd: bigint | null;
}

export interface ProviderPerformance {
  readonly providerId: string;
  readonly name: string;
  readonly code: string;
  readonly simulated: boolean;
  readonly healthStatus: string;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly pending: number;
  readonly successRateBps: number;
  readonly avgCompletionSeconds: number | null;
  readonly valueUsd: bigint;
}

async function providerPerformance(range: ReportRange): Promise<ProviderPerformance[]> {
  const rows = await db.$queryRaw<ProviderPerfRow[]>`
    SELECT p.id AS provider_id, p.name, p.code, p.adapter, p.health_status::text AS health_status,
           COUNT(t.id) AS total,
           COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED') AS completed,
           COUNT(t.id) FILTER (WHERE t.status IN ('FAILED', 'REJECTED')) AS failed,
           COUNT(t.id) FILTER (WHERE t.status = 'PROCESSING') AS pending,
           AVG(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)))
             FILTER (WHERE t.status = 'COMPLETED')::float8 AS avg_seconds,
           SUM(t.send_amount_usd) FILTER (WHERE t.status = 'COMPLETED') AS value_usd
    FROM providers p
    LEFT JOIN transfers t ON t.provider_id = p.id
      AND t.created_at >= ${range.from} AND t.created_at <= ${range.to}
    GROUP BY p.id ORDER BY COUNT(t.id) DESC, p.name`;
  return rows.map((row) => {
    const decided = num(row.completed) + num(row.failed);
    return {
      providerId: row.provider_id,
      name: row.name,
      code: row.code,
      simulated: row.adapter === 'simulator',
      healthStatus: row.health_status,
      total: num(row.total),
      completed: num(row.completed),
      failed: num(row.failed),
      pending: num(row.pending),
      successRateBps: ratioBps(num(row.completed), decided),
      avgCompletionSeconds: row.avg_seconds === null ? null : Math.round(row.avg_seconds),
      valueUsd: big(row.value_usd),
    };
  });
}

/** Operational dashboard: status and type mix, provider performance, queues, recent failures. */
export async function getOperationalDashboard(
  ctx: ActionContext,
  range: ReportRange = resolveRange(),
) {
  assertPermission(ctx, 'reports:read');
  const [totals, byStatus, byType, providers, stuck, recentFailures, webhookEvents] =
    await Promise.all([
      transferTotals(range),
      db.$queryRaw<Array<{ status: TransferStatus; count: bigint }>>`
      SELECT status, COUNT(*) AS count FROM transfers
      WHERE created_at >= ${range.from} AND created_at <= ${range.to}
      GROUP BY status ORDER BY COUNT(*) DESC`,
      db.$queryRaw<Array<{ type: TransferType; count: bigint; value_usd: bigint | null }>>`
      SELECT type, COUNT(*) AS count, SUM(send_amount_usd) FILTER (WHERE status = 'COMPLETED') AS value_usd
      FROM transfers
      WHERE created_at >= ${range.from} AND created_at <= ${range.to}
      GROUP BY type ORDER BY COUNT(*) DESC`,
      providerPerformance(range),
      db.transfer.findMany({
        where: { status: 'PROCESSING', createdAt: { lt: new Date(Date.now() - 15 * 60_000) } },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: {
          id: true,
          reference: true,
          type: true,
          recipientName: true,
          sendAmount: true,
          sourceCurrency: true,
          createdAt: true,
          providerId: true,
        },
      }),
      db.transfer.findMany({
        where: {
          status: { in: ['FAILED', 'REJECTED'] },
          createdAt: { gte: range.from, lte: range.to },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          reference: true,
          type: true,
          status: true,
          failureCode: true,
          failureReason: true,
          sendAmount: true,
          sourceCurrency: true,
          createdAt: true,
        },
      }),
      db.providerWebhookEvent.groupBy({
        by: ['status'],
        where: { receivedAt: { gte: range.from, lte: range.to } },
        _count: { _all: true },
      }),
    ]);
  return {
    range,
    totals,
    byStatus: byStatus.map((row) => ({ status: row.status, count: num(row.count) })),
    byType: byType.map((row) => ({
      type: row.type,
      count: num(row.count),
      valueUsd: big(row.value_usd),
    })),
    providers,
    /** PROCESSING for more than 15 minutes — candidates for a status refresh. */
    stuck,
    recentFailures,
    webhookEvents: webhookEvents.map((row) => ({ status: row.status, count: row._count._all })),
  };
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

interface RevenueDayRow {
  day: Date;
  fee_usd: bigint | null;
  fx_usd: bigint | null;
  count: bigint;
}

interface RevenueCurrencyRow {
  currency: string;
  fees: bigint | null;
  fx_margin: bigint | null;
  count: bigint;
}

/** Revenue dashboard: fees and FX margin by day, corridor, type and source currency. */
export async function getRevenueDashboard(ctx: ActionContext, range: ReportRange = resolveRange()) {
  assertPermission(ctx, 'reports:read');
  const [byDay, corridors, byType, byCurrency, commissions] = await Promise.all([
    db.$queryRaw<RevenueDayRow[]>`
      SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
             SUM(CASE WHEN fee_amount + fx_margin_amount = 0 THEN 0
                      ELSE revenue_usd - revenue_usd * fx_margin_amount / (fee_amount + fx_margin_amount) END) AS fee_usd,
             SUM(CASE WHEN fee_amount + fx_margin_amount = 0 THEN 0
                      ELSE revenue_usd * fx_margin_amount / (fee_amount + fx_margin_amount) END) AS fx_usd,
             COUNT(*) AS count
      FROM transfers
      WHERE status = 'COMPLETED' AND created_at >= ${range.from} AND created_at <= ${range.to}
      GROUP BY 1 ORDER BY 1`,
    corridorStats(range, 20),
    db.$queryRaw<Array<{ type: TransferType; count: bigint; revenue_usd: bigint | null }>>`
      SELECT type, COUNT(*) AS count, SUM(revenue_usd) AS revenue_usd FROM transfers
      WHERE status = 'COMPLETED' AND created_at >= ${range.from} AND created_at <= ${range.to}
      GROUP BY type ORDER BY SUM(revenue_usd) DESC`,
    db.$queryRaw<RevenueCurrencyRow[]>`
      SELECT source_currency AS currency, SUM(fee_amount) AS fees, SUM(fx_margin_amount) AS fx_margin, COUNT(*) AS count
      FROM transfers
      WHERE status = 'COMPLETED' AND created_at >= ${range.from} AND created_at <= ${range.to}
      GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<Array<{ currency: string; amount: bigint | null }>>`
      SELECT currency, SUM(amount) AS amount FROM commissions
      WHERE status <> 'REVERSED' AND created_at >= ${range.from} AND created_at <= ${range.to}
      GROUP BY 1 ORDER BY 1`,
  ]);
  const daily = byDay.map((row) => ({
    date: row.day.toISOString().slice(0, 10),
    feeUsd: big(row.fee_usd),
    fxMarginUsd: big(row.fx_usd),
    count: num(row.count),
  }));
  const feeUsd = daily.reduce((total, row) => total + row.feeUsd, 0n);
  const fxMarginUsd = daily.reduce((total, row) => total + row.fxMarginUsd, 0n);
  return {
    range,
    totals: { feeUsd, fxMarginUsd, revenueUsd: feeUsd + fxMarginUsd },
    daily,
    corridors,
    byType: byType.map((row) => ({
      type: row.type,
      count: num(row.count),
      revenueUsd: big(row.revenue_usd),
    })),
    /** Native-currency revenue per source currency (exact ledger amounts). */
    byCurrency: byCurrency.map((row) => ({
      currency: row.currency,
      fees: big(row.fees),
      fxMargin: big(row.fx_margin),
      count: num(row.count),
      commissions: big(
        commissions.find((commission) => commission.currency === row.currency)?.amount,
      ),
    })),
  };
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

/** Compliance dashboard: KYC funnel, alerts, cases, SARs, held funds, risk distribution. */
export async function getComplianceDashboard(
  ctx: ActionContext,
  range: ReportRange = resolveRange(),
) {
  assertPermission(ctx, 'reports:read');
  const [
    kycByStatus,
    kycQueue,
    riskLevels,
    alertsByStatus,
    alertsByRule,
    casesByStatus,
    sarsByStatus,
    held,
    flaggedCustomers,
  ] = await Promise.all([
    db.user.groupBy({ by: ['kycStatus'], where: { role: 'CUSTOMER' }, _count: { _all: true } }),
    db.kycCase.count({ where: { status: { in: ['SUBMITTED', 'IN_REVIEW'] } } }),
    db.user.groupBy({ by: ['riskLevel'], where: { role: 'CUSTOMER' }, _count: { _all: true } }),
    db.amlAlert.groupBy({
      by: ['status'],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),
    db.amlAlert.groupBy({
      by: ['ruleCode', 'severity'],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
      orderBy: { _count: { ruleCode: 'desc' } },
    }),
    db.amlCase.groupBy({ by: ['status'], _count: { _all: true } }),
    db.sarReport.groupBy({ by: ['status'], _count: { _all: true } }),
    db.$queryRaw<Array<{ count: bigint; value_usd: bigint | null }>>`
        SELECT COUNT(*) AS count, SUM(send_amount_usd) AS value_usd FROM transfers WHERE status = 'ON_HOLD'`,
    db.user.count({
      where: { role: 'CUSTOMER', OR: [{ pepMatch: true }, { sanctionsMatch: true }] },
    }),
  ]);
  return {
    range,
    kyc: {
      byStatus: kycByStatus.map((row) => ({ status: row.kycStatus, count: row._count._all })),
      queue: kycQueue,
    },
    risk: riskLevels.map((row) => ({ level: row.riskLevel, count: row._count._all })),
    alerts: {
      byStatus: alertsByStatus.map((row) => ({ status: row.status, count: row._count._all })),
      byRule: alertsByRule.map((row) => ({
        ruleCode: row.ruleCode,
        severity: row.severity,
        count: row._count._all,
      })),
    },
    cases: casesByStatus.map((row) => ({ status: row.status, count: row._count._all })),
    sars: sarsByStatus.map((row) => ({ status: row.status, count: row._count._all })),
    held: { count: num(held[0]?.count), valueUsd: big(held[0]?.value_usd) },
    /** Customers whose name matches the demo sanctions / PEP list. */
    flaggedCustomers,
  };
}

// ---------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------

interface TreasuryAccountRow {
  currency: string;
  type: string;
  balance: bigint;
  id: string;
}

interface FxPairRow {
  source_currency: string;
  target_currency: string;
  count: bigint;
  send_amount: bigint | null;
  receive_amount: bigint | null;
  fx_margin: bigint | null;
  fx_margin_usd: bigint | null;
}

export interface TreasuryCurrencyPosition {
  readonly currency: string;
  /** Float held with operators (settlement account). */
  readonly float: bigint;
  readonly floatAccountId: string | null;
  readonly lowBalance: bigint | null;
  readonly criticalBalance: bigint | null;
  readonly liquidity: LiquidityLevel;
  /** Customer + partner wallet balances (liabilities). */
  readonly walletLiabilities: bigint;
  /** Funds reserved for held / in-flight transfers. */
  readonly suspense: bigint;
  /** Positive = long, negative = short. */
  readonly fxPosition: bigint;
  readonly feeRevenue: bigint;
  readonly fxRevenue: bigint;
  readonly commissionPayable: bigint;
  readonly commissionExpense: bigint;
  readonly capital: bigint;
}

/** Treasury dashboard: float and liquidity alerts per currency, positions, FX profitability. */
export async function getTreasuryDashboard(
  ctx: ActionContext,
  range: ReportRange = resolveRange(),
) {
  assertPermission(ctx, 'treasury:read');
  const [accounts, thresholds, fxPairs, integrity] = await Promise.all([
    db.$queryRaw<TreasuryAccountRow[]>`
      SELECT currency, type::text AS type, SUM(balance) AS balance,
             (ARRAY_AGG(id::text ORDER BY created_at))[1] AS id
      FROM ledger_accounts GROUP BY currency, type ORDER BY currency`,
    db.treasuryThreshold.findMany({
      select: { accountId: true, lowBalance: true, criticalBalance: true },
    }),
    db.$queryRaw<FxPairRow[]>`
      SELECT source_currency, target_currency, COUNT(*) AS count,
             SUM(send_amount) AS send_amount, SUM(receive_amount) AS receive_amount,
             SUM(fx_margin_amount) AS fx_margin,
             SUM(CASE WHEN fee_amount + fx_margin_amount = 0 THEN 0
                      ELSE revenue_usd * fx_margin_amount / (fee_amount + fx_margin_amount) END) AS fx_margin_usd
      FROM transfers
      WHERE status = 'COMPLETED' AND source_currency <> target_currency
        AND created_at >= ${range.from} AND created_at <= ${range.to}
      GROUP BY 1, 2 ORDER BY SUM(send_amount_usd) DESC`,
    verifyLedgerIntegrity(),
  ]);
  const currencies = [...new Set(accounts.map((row) => row.currency))].sort();
  const positions: TreasuryCurrencyPosition[] = currencies.map((currency) => {
    const pick = (type: string) =>
      accounts.find((row) => row.currency === currency && row.type === type);
    const floatAccount = pick('SETTLEMENT');
    const threshold = thresholds.find((row) => row.accountId === floatAccount?.id) ?? null;
    const float = big(floatAccount?.balance);
    return {
      currency,
      float,
      floatAccountId: floatAccount?.id ?? null,
      lowBalance: threshold?.lowBalance ?? null,
      criticalBalance: threshold?.criticalBalance ?? null,
      liquidity: liquidityLevel(float, threshold),
      walletLiabilities: big(pick('WALLET')?.balance),
      suspense: big(pick('SUSPENSE')?.balance),
      fxPosition: big(pick('FX_POSITION')?.balance),
      feeRevenue: big(pick('FEE_REVENUE')?.balance),
      fxRevenue: big(pick('FX_REVENUE')?.balance),
      commissionPayable: big(pick('COMMISSION_PAYABLE')?.balance),
      commissionExpense: big(pick('COMMISSION_EXPENSE')?.balance),
      capital: big(pick('CAPITAL')?.balance),
    };
  });
  return {
    range,
    positions,
    alerts: positions.filter((position) => position.liquidity !== 'OK'),
    fxPairs: fxPairs.map((row) => ({
      sourceCurrency: row.source_currency,
      targetCurrency: row.target_currency,
      count: num(row.count),
      sendAmount: big(row.send_amount),
      receiveAmount: big(row.receive_amount),
      fxMargin: big(row.fx_margin),
      fxMarginUsd: big(row.fx_margin_usd),
    })),
    integrity,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation (phase 6)
// ---------------------------------------------------------------------------

interface SuspenseRow {
  currency: string;
  expected: bigint | null;
  actual: bigint | null;
}

/**
 * Reconciliation view: ledger integrity per currency, reserved funds vs. the suspense accounts,
 * completed transfers without a settlement journal and in-flight provider transfers.
 */
export async function getReconciliation(ctx: ActionContext) {
  assertPermission(ctx, 'transfers:read');
  const [integrity, suspense, unposted, inFlight] = await Promise.all([
    verifyLedgerIntegrity(),
    db.$queryRaw<SuspenseRow[]>`
      SELECT a.currency,
             (SELECT COALESCE(SUM(t.total_debit), 0) FROM transfers t
               WHERE t.source_currency = a.currency AND t.type <> 'TOPUP'
                 AND t.status IN ('ON_HOLD', 'PROCESSING')) AS expected,
             a.balance AS actual
      FROM ledger_accounts a WHERE a.type = 'SUSPENSE' ORDER BY a.currency`,
    db.$queryRaw<Array<{ id: string; reference: string }>>`
      SELECT t.id::text AS id, t.reference FROM transfers t
      WHERE t.status = 'COMPLETED'
        AND NOT EXISTS (SELECT 1 FROM journals j WHERE j.transfer_id = t.id AND j.kind IN ('TRANSFER', 'RELEASE', 'TOPUP'))
      LIMIT 50`,
    db.transfer.findMany({
      where: { status: 'PROCESSING' },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: {
        id: true,
        reference: true,
        type: true,
        providerRef: true,
        recipientAccount: true,
        totalDebit: true,
        sourceCurrency: true,
        createdAt: true,
        provider: { select: { name: true, code: true } },
      },
    }),
  ]);
  const suspenseChecks = suspense.map((row) => ({
    currency: row.currency,
    expected: big(row.expected),
    actual: big(row.actual),
    matches: big(row.expected) === big(row.actual),
  }));
  return {
    integrity,
    suspense: suspenseChecks,
    /** Completed transfers with no settlement journal — must be empty. */
    unposted,
    inFlight,
    healthy:
      integrity.every((row) => row.balanced) &&
      suspenseChecks.every((row) => row.matches) &&
      unposted.length === 0,
  };
}

/** Thin guard for pages that show several dashboards. */
export function assertCanViewReports(ctx: ActionContext): void {
  if (ctx.actor.type === 'API_KEY')
    throw new AppError('FORBIDDEN', 'Reports are not available to API keys');
  assertPermission(ctx, 'reports:read');
}
