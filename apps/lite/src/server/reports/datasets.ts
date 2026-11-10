import { writeAudit } from '../audit';
import { db } from '../db';
import { AppError } from '../errors';
import { formatRate, parseRate, toMajorString } from '../money';
import { type ActionContext, assertPermission } from '../rbac';
import {
  type ReportRange,
  getOperationalDashboard,
  getRevenueDashboard,
  getTreasuryDashboard,
  resolveRange,
} from './dashboards';
import { type ExportFormat, type ExportedFile, type ReportTable, exportTable } from './exports';

/**
 * Named datasets that can be exported as CSV / Excel / PDF from the reporting area.
 * Every dataset requires `reports:export`; `audit` additionally requires `audit:read`.
 */

export const REPORT_NAMES = [
  'transfers',
  'revenue',
  'corridors',
  'providers',
  'compliance',
  'treasury',
  'commissions',
  'audit',
] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export const REPORT_LABELS: Readonly<Record<ReportName, string>> = {
  transfers: 'Transfers',
  revenue: 'Daily revenue',
  corridors: 'Corridors',
  providers: 'Provider performance',
  compliance: 'AML alerts',
  treasury: 'Treasury positions',
  commissions: 'Partner commissions',
  audit: 'Audit log',
};

export const isReportName = (value: string): value is ReportName =>
  (REPORT_NAMES as readonly string[]).includes(value);

const MAX_ROWS = 5000;
const usd = (cents: bigint): string => toMajorString(cents, 'USD');
const stamp = (date: Date | null): string =>
  date ? date.toISOString().replace('T', ' ').slice(0, 19) : '';
const percent = (bps: number): string => `${(bps / 100).toFixed(2)}%`;
const periodLabel = (range: ReportRange): string =>
  `${range.from.toISOString().slice(0, 10)} to ${range.to.toISOString().slice(0, 10)}`;

/** Builds the tabular dataset for a named report. */
export async function buildReportTable(
  ctx: ActionContext,
  name: ReportName,
  range: ReportRange = resolveRange(),
): Promise<ReportTable> {
  assertPermission(ctx, 'reports:export');
  const generatedAt = new Date();
  const base = { title: REPORT_LABELS[name], subtitle: periodLabel(range), generatedAt };

  switch (name) {
    case 'transfers': {
      const rows = await db.transfer.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      });
      return {
        ...base,
        columns: [
          { key: 'createdAt', label: 'Created (UTC)', width: 1.3 },
          { key: 'reference', label: 'Reference', width: 1.1 },
          { key: 'type', label: 'Type', width: 0.9 },
          { key: 'status', label: 'Status', width: 0.9 },
          { key: 'sender', label: 'Sender', width: 1.4 },
          { key: 'recipient', label: 'Recipient', width: 1.4 },
          { key: 'corridor', label: 'Corridor', width: 0.7 },
          { key: 'send', label: 'Send', align: 'right', width: 1.1 },
          { key: 'fee', label: 'Fee', align: 'right', width: 0.8 },
          { key: 'receive', label: 'Receive', align: 'right', width: 1.1 },
          { key: 'rate', label: 'Rate', align: 'right', width: 0.8 },
          { key: 'usd', label: 'USD value', align: 'right', width: 0.9 },
        ],
        rows: rows.map((row) => ({
          createdAt: stamp(row.createdAt),
          reference: row.reference,
          type: row.type,
          status: row.status,
          sender: row.senderName,
          recipient: row.recipientName,
          corridor: `${row.sourceCountry}-${row.targetCountry}`,
          send: `${toMajorString(row.sendAmount, row.sourceCurrency)} ${row.sourceCurrency}`,
          fee: `${toMajorString(row.feeAmount, row.sourceCurrency)} ${row.sourceCurrency}`,
          receive: `${toMajorString(row.receiveAmount, row.targetCurrency)} ${row.targetCurrency}`,
          rate:
            row.sourceCurrency === row.targetCurrency
              ? ''
              : formatRate(parseRate(row.customerRate), 4),
          usd: usd(row.sendAmountUsd),
        })),
      };
    }
    case 'revenue': {
      const revenue = await getRevenueDashboard(ctx, range);
      return {
        ...base,
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'count', label: 'Transfers', align: 'right' },
          { key: 'fees', label: 'Fees (USD)', align: 'right' },
          { key: 'fx', label: 'FX margin (USD)', align: 'right' },
          { key: 'total', label: 'Revenue (USD)', align: 'right' },
        ],
        rows: revenue.daily.map((row) => ({
          date: row.date,
          count: row.count,
          fees: usd(row.feeUsd),
          fx: usd(row.fxMarginUsd),
          total: usd(row.feeUsd + row.fxMarginUsd),
        })),
      };
    }
    case 'corridors': {
      const revenue = await getRevenueDashboard(ctx, range);
      return {
        ...base,
        columns: [
          { key: 'corridor', label: 'Corridor' },
          { key: 'pair', label: 'Currencies' },
          { key: 'count', label: 'Transfers', align: 'right' },
          { key: 'value', label: 'Value (USD)', align: 'right' },
          { key: 'revenue', label: 'Revenue (USD)', align: 'right' },
          { key: 'fx', label: 'FX margin (USD)', align: 'right' },
        ],
        rows: revenue.corridors.map((row) => ({
          corridor: `${row.sourceCountry}-${row.targetCountry}`,
          pair: `${row.sourceCurrency}/${row.targetCurrency}`,
          count: row.count,
          value: usd(row.valueUsd),
          revenue: usd(row.revenueUsd),
          fx: usd(row.fxMarginUsd),
        })),
      };
    }
    case 'providers': {
      const operations = await getOperationalDashboard(ctx, range);
      return {
        ...base,
        columns: [
          { key: 'name', label: 'Provider', width: 1.6 },
          { key: 'mode', label: 'Mode' },
          { key: 'health', label: 'Health' },
          { key: 'total', label: 'Transactions', align: 'right' },
          { key: 'completed', label: 'Completed', align: 'right' },
          { key: 'failed', label: 'Failed', align: 'right' },
          { key: 'pending', label: 'Pending', align: 'right' },
          { key: 'success', label: 'Success rate', align: 'right' },
          { key: 'value', label: 'Value (USD)', align: 'right' },
        ],
        rows: operations.providers.map((row) => ({
          name: row.name,
          mode: row.simulated ? 'Simulated' : 'Live',
          health: row.healthStatus,
          total: row.total,
          completed: row.completed,
          failed: row.failed,
          pending: row.pending,
          success: percent(row.successRateBps),
          value: usd(row.valueUsd),
        })),
      };
    }
    case 'compliance': {
      assertPermission(ctx, 'aml:read');
      const alerts = await db.amlAlert.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        include: {
          user: { select: { fullName: true } },
          transfer: { select: { reference: true, sendAmountUsd: true } },
          case: { select: { reference: true, status: true } },
        },
      });
      return {
        ...base,
        columns: [
          { key: 'createdAt', label: 'Raised (UTC)', width: 1.2 },
          { key: 'rule', label: 'Rule', width: 1.3 },
          { key: 'severity', label: 'Severity', width: 0.7 },
          { key: 'action', label: 'Action', width: 0.6 },
          { key: 'status', label: 'Status', width: 0.8 },
          { key: 'customer', label: 'Customer', width: 1.3 },
          { key: 'transfer', label: 'Transfer', width: 1 },
          { key: 'usd', label: 'USD value', align: 'right', width: 0.8 },
          { key: 'case', label: 'Case', width: 1 },
          { key: 'message', label: 'Detail', width: 2.4 },
        ],
        rows: alerts.map((alert) => ({
          createdAt: stamp(alert.createdAt),
          rule: alert.ruleCode,
          severity: alert.severity,
          action: alert.action,
          status: alert.status,
          customer: alert.user?.fullName ?? '',
          transfer: alert.transfer?.reference ?? '',
          usd: alert.transfer ? usd(alert.transfer.sendAmountUsd) : '',
          case: alert.case ? `${alert.case.reference} (${alert.case.status})` : '',
          message: alert.message,
        })),
      };
    }
    case 'treasury': {
      const treasury = await getTreasuryDashboard(ctx, range);
      const money = (amount: bigint, currency: string) => toMajorString(amount, currency);
      return {
        ...base,
        subtitle: 'Balances as of now',
        columns: [
          { key: 'currency', label: 'Currency', width: 0.6 },
          { key: 'float', label: 'Float', align: 'right' },
          { key: 'liquidity', label: 'Liquidity', width: 0.7 },
          { key: 'low', label: 'Low threshold', align: 'right' },
          { key: 'wallets', label: 'Wallet liabilities', align: 'right' },
          { key: 'suspense', label: 'Suspense', align: 'right' },
          { key: 'fxPosition', label: 'FX position', align: 'right' },
          { key: 'fees', label: 'Fee revenue', align: 'right' },
          { key: 'fx', label: 'FX revenue', align: 'right' },
          { key: 'payable', label: 'Commission payable', align: 'right' },
        ],
        rows: treasury.positions.map((row) => ({
          currency: row.currency,
          float: money(row.float, row.currency),
          liquidity: row.liquidity,
          low: row.lowBalance === null ? '' : money(row.lowBalance, row.currency),
          wallets: money(row.walletLiabilities, row.currency),
          suspense: money(row.suspense, row.currency),
          fxPosition: money(row.fxPosition, row.currency),
          fees: money(row.feeRevenue, row.currency),
          fx: money(row.fxRevenue, row.currency),
          payable: money(row.commissionPayable, row.currency),
        })),
      };
    }
    case 'commissions': {
      assertPermission(ctx, 'partners:read');
      const commissions = await db.commission.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        include: {
          partner: { select: { name: true, code: true } },
          transfer: { select: { reference: true } },
          settlement: { select: { reference: true } },
        },
      });
      return {
        ...base,
        columns: [
          { key: 'createdAt', label: 'Accrued (UTC)', width: 1.2 },
          { key: 'partner', label: 'Partner', width: 1.6 },
          { key: 'code', label: 'Code', width: 0.8 },
          { key: 'transfer', label: 'Transfer' },
          { key: 'amount', label: 'Commission', align: 'right' },
          { key: 'bps', label: 'Rate (bps)', align: 'right', width: 0.6 },
          { key: 'status', label: 'Status', width: 0.8 },
          { key: 'settlement', label: 'Settlement', width: 1.2 },
        ],
        rows: commissions.map((commission) => ({
          createdAt: stamp(commission.createdAt),
          partner: commission.partner.name,
          code: commission.partner.code,
          transfer: commission.transfer.reference,
          amount: `${toMajorString(commission.amount, commission.currency)} ${commission.currency}`,
          bps: commission.bps,
          status: commission.status,
          settlement: commission.settlement?.reference ?? '',
        })),
      };
    }
    case 'audit': {
      assertPermission(ctx, 'audit:read');
      const logs = await db.auditLog.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      });
      return {
        ...base,
        columns: [
          { key: 'createdAt', label: 'When (UTC)', width: 1.2 },
          { key: 'actor', label: 'Actor', width: 1.6 },
          { key: 'role', label: 'Role', width: 0.8 },
          { key: 'action', label: 'Action', width: 1.6 },
          { key: 'resource', label: 'Resource', width: 1.8 },
          { key: 'outcome', label: 'Outcome', width: 0.7 },
          { key: 'ip', label: 'IP', width: 0.9 },
          { key: 'requestId', label: 'Request id', width: 1.6 },
        ],
        rows: logs.map((log) => ({
          createdAt: stamp(log.createdAt),
          actor: log.actorLabel ?? '',
          role: log.actorRole ?? '',
          action: log.action,
          resource: `${log.resourceType}${log.resourceId ? `:${log.resourceId}` : ''}`,
          outcome: log.outcome,
          ip: log.ip ?? '',
          requestId: log.requestId ?? '',
        })),
      };
    }
  }
}

/** Builds and renders a named report. Audited (who exported what, when, how many rows). */
export async function exportReport(
  ctx: ActionContext,
  name: string,
  format: string,
  range: ReportRange = resolveRange(),
): Promise<ExportedFile> {
  if (!isReportName(name)) throw new AppError('NOT_FOUND', 'Unknown report');
  if (!['csv', 'xlsx', 'pdf'].includes(format))
    throw new AppError('VALIDATION', 'Format must be csv, xlsx or pdf');
  const table = await buildReportTable(ctx, name, range);
  const file = await exportTable(table, format as ExportFormat);
  await writeAudit(db, ctx, {
    action: 'report.export',
    resourceType: 'report',
    resourceId: name,
    metadata: {
      format,
      rows: table.rows.length,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
  });
  return file;
}
