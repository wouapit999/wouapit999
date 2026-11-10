import Link from 'next/link';

import { ActionButton } from '@/components/admin/action-button';
import { BarList, SegmentBar } from '@/components/admin/charts';
import { FilterBar } from '@/components/admin/filter-bar';
import { enumOptions, hrefWith, usd } from '@/components/admin/helpers';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  FormActions,
  FormMessage,
  Input,
  LinkButton,
  Money,
  Pagination,
  Select,
  Stat,
  StatGrid,
  StatusBadge,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
} from '@/components/ui';
import { formatDate, formatDateTime, humanize } from '@/lib/format';
import { listAlerts, listAmlRules, listCases, listSanctionsEntries, listSars } from '@/server/aml';
import { toMajorString } from '@/server/money';
import type { ActionContext } from '@/server/rbac';
import { getComplianceDashboard, resolveRange } from '@/server/reports';

import {
  addSanctionsEntryAction,
  dismissAlertAction,
  escalateAlertAction,
  setSanctionsEntryActiveAction,
  toggleAmlRuleAction,
  updateAmlRuleAction,
} from './actions';

const BASE = '/admin/compliance';
const ALERT_STATUSES = ['OPEN', 'ESCALATED', 'DISMISSED', 'RESOLVED'] as const;
const CASE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'RELEASED', 'REJECTED', 'CLOSED'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | undefined =>
  values.find((candidate) => candidate === value);

const caseStatusLabel = (status: string): string | undefined =>
  status === 'REJECTED' ? 'Rejected' : undefined;

const count = (rows: ReadonlyArray<{ status: string; count: number }>, ...statuses: string[]) =>
  rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.count, 0);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function OverviewSection({ ctx }: { ctx: ActionContext }) {
  const dashboard = await getComplianceDashboard(ctx, resolveRange({ days: 30 }));
  const riskTone = { LOW: 'success', MEDIUM: 'warning', HIGH: 'danger' } as const;
  return (
    <>
      <StatGrid>
        <Stat
          label="Transfers on hold"
          value={dashboard.held.count}
          hint={`${usd(dashboard.held.valueUsd)} reserved`}
          tone={dashboard.held.count > 0 ? 'warning' : 'default'}
        />
        <Stat
          label="Open alerts"
          value={count(dashboard.alerts.byStatus, 'OPEN')}
          hint="Raised in the last 30 days"
        />
        <Stat
          label="Open cases"
          value={count(dashboard.cases, 'OPEN', 'UNDER_REVIEW')}
          hint={`${count(dashboard.cases, 'RELEASED', 'REJECTED', 'CLOSED')} closed`}
        />
        <Stat
          label="SARs filed"
          value={count(dashboard.sars, 'FILED')}
          hint={`${count(dashboard.sars, 'DRAFT')} in draft`}
        />
        <Stat label="KYC cases to review" value={dashboard.kyc.queue} />
        <Stat
          label="Screening matches"
          value={dashboard.flaggedCustomers}
          hint="Customers matching the demo list"
        />
      </StatGrid>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Alerts by rule" description="Last 30 days" />
          <CardBody>
            <BarList
              tone="danger"
              emptyLabel="No alert in the last 30 days."
              items={dashboard.alerts.byRule.map((row) => ({
                key: `${row.ruleCode}-${row.severity}`,
                label: `${row.ruleCode} · ${humanize(row.severity)}`,
                value: row.count,
                display: String(row.count),
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Customer risk" description="All customers" />
          <CardBody className="space-y-5">
            <SegmentBar
              title="Risk level"
              segments={(['LOW', 'MEDIUM', 'HIGH'] as const).map((level) => ({
                key: level,
                label: humanize(level),
                value: dashboard.risk.find((row) => row.level === level)?.count ?? 0,
                tone: riskTone[level],
              }))}
            />
            <SegmentBar
              title="KYC status"
              segments={[
                { key: 'VERIFIED', label: 'Verified', tone: 'success' as const },
                { key: 'PENDING', label: 'Pending', tone: 'info' as const },
                { key: 'NONE', label: 'Not started', tone: 'neutral' as const },
                { key: 'REJECTED', label: 'Rejected', tone: 'danger' as const },
              ].map((segment) => ({
                ...segment,
                value: dashboard.kyc.byStatus.find((row) => row.status === segment.key)?.count ?? 0,
              }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Alert outcomes" description="Last 30 days" />
          <CardBody>
            <SegmentBar
              title="Alerts by status"
              segments={[
                { key: 'OPEN', label: 'Open', tone: 'warning' as const },
                { key: 'ESCALATED', label: 'Escalated', tone: 'danger' as const },
                { key: 'RESOLVED', label: 'Resolved', tone: 'success' as const },
                { key: 'DISMISSED', label: 'Dismissed', tone: 'neutral' as const },
              ].map((segment) => ({
                ...segment,
                value: count(dashboard.alerts.byStatus, segment.key),
              }))}
            />
          </CardBody>
        </Card>
      </div>
      <Alert tone="info" className="mt-5">
        Sanctions and PEP screening runs against a fictional demo list. It demonstrates the
        workflow; it is not a real watch list and must be replaced before any production use.
      </Alert>
    </>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export async function AlertsSection({
  ctx,
  canWrite,
  status,
  severity,
  page,
}: {
  ctx: ActionContext;
  canWrite: boolean;
  status: string | undefined;
  severity: (typeof SEVERITIES)[number] | undefined;
  page: number;
}) {
  const statusFilter = status === 'ALL' ? undefined : (oneOf(ALERT_STATUSES, status) ?? 'OPEN');
  const result = await listAlerts(ctx, { status: statusFilter, severity, page, pageSize: 20 });
  const filters = { tab: 'alerts', status: statusFilter ?? 'ALL', severity };
  return (
    <Card>
      <FilterBar action={BASE} hidden={{ tab: 'alerts' }} resetHref={`${BASE}?tab=alerts`}>
        <Select
          name="status"
          label="Status"
          defaultValue={statusFilter ?? 'ALL'}
          options={[
            ...enumOptions(ALERT_STATUSES, humanize),
            { value: 'ALL', label: 'All alerts' },
          ]}
        />
        <Select
          name="severity"
          label="Severity"
          placeholder="Any severity"
          defaultValue={severity}
          options={enumOptions(SEVERITIES, humanize)}
        />
      </FilterBar>
      {result.items.length === 0 ? (
        <EmptyState
          title="No alert matches"
          description="Alerts appear when the rule engine flags a transfer or a screening hit."
        />
      ) : (
        <>
          <Table caption="AML alerts">
            <THead>
              <Tr>
                <Th>Raised</Th>
                <Th>Rule</Th>
                <Th>Customer</Th>
                <Th>Transfer</Th>
                <Th>Severity</Th>
                <Th>Status</Th>
                {canWrite ? <Th>Decision</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {result.items.map((alert) => (
                <Tr key={alert.id} data-alert={alert.ruleCode}>
                  <Td className="whitespace-nowrap">{formatDateTime(alert.createdAt)}</Td>
                  <Td>
                    <code className="text-xs">{alert.ruleCode}</code>{' '}
                    <Badge tone={alert.action === 'HOLD' ? 'danger' : 'warning'}>
                      {humanize(alert.action)}
                    </Badge>
                    <p className="max-w-xs text-xs text-fg-muted">{alert.message}</p>
                  </Td>
                  <Td>
                    {alert.user ? (
                      <Link href={`/admin/customers/${alert.user.id}`} className="underline">
                        {alert.user.fullName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    {alert.transfer ? (
                      <>
                        <Link
                          href={`/admin/transfers/${alert.transfer.id}`}
                          className="tabular underline"
                        >
                          {alert.transfer.reference}
                        </Link>
                        <p className="text-xs text-fg-muted">
                          <Money
                            amount={alert.transfer.sendAmount}
                            currency={alert.transfer.sourceCurrency}
                          />
                        </p>
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={alert.severity} />{' '}
                    <span className="tabular text-xs text-fg-muted">+{alert.score}</span>
                  </Td>
                  <Td>
                    <StatusBadge status={alert.status} />
                    {alert.case ? (
                      <p className="text-xs">
                        <Link href={`${BASE}/cases/${alert.case.id}`} className="underline">
                          {alert.case.reference}
                        </Link>
                      </p>
                    ) : null}
                  </Td>
                  {canWrite ? (
                    <Td className="min-w-56">
                      {alert.status === 'OPEN' ? (
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-accent">
                            Decide<span className="sr-only"> on alert {alert.ruleCode}</span>
                          </summary>
                          <div className="mt-2 space-y-3">
                            <ActionButton
                              action={escalateAlertAction}
                              fields={{ alertId: alert.id }}
                              variant="primary"
                            >
                              Escalate to a case
                            </ActionButton>
                            <ActionForm action={dismissAlertAction} className="space-y-2">
                              <input type="hidden" name="alertId" value={alert.id} />
                              <Input
                                name="note"
                                label="Why it is a false positive"
                                required
                                minLength={3}
                              />
                              <FormMessage showSuccess={false} />
                              <SubmitButton size="sm" variant="secondary">
                                Dismiss alert
                              </SubmitButton>
                            </ActionForm>
                          </div>
                        </details>
                      ) : (
                        <span className="text-xs text-fg-muted">Decided</span>
                      )}
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            hrefFor={(next) => hrefWith(BASE, { ...filters, page: next })}
          />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export async function CasesSection({
  ctx,
  status,
  page,
}: {
  ctx: ActionContext;
  status: string | undefined;
  page: number;
}) {
  const statusFilter = oneOf(CASE_STATUSES, status);
  const result = await listCases(ctx, { status: statusFilter, page, pageSize: 20 });
  return (
    <Card>
      <FilterBar action={BASE} hidden={{ tab: 'cases' }} resetHref={`${BASE}?tab=cases`}>
        <Select
          name="status"
          label="Status"
          placeholder="All cases"
          defaultValue={statusFilter}
          options={enumOptions(CASE_STATUSES, (value) => caseStatusLabel(value) ?? humanize(value))}
        />
      </FilterBar>
      {result.items.length === 0 ? (
        <EmptyState
          title="No case matches"
          description="A case opens automatically when a transfer is held, or when an alert is escalated."
        />
      ) : (
        <>
          <Table caption="Compliance cases">
            <THead>
              <Tr>
                <Th>Case</Th>
                <Th>Subject</Th>
                <Th>Transfer</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
                <Th align="right">Alerts</Th>
                <Th align="right">Notes</Th>
                <Th>Opened</Th>
              </Tr>
            </THead>
            <TBody>
              {result.items.map((amlCase) => (
                <Tr key={amlCase.id} data-case={amlCase.reference}>
                  <Td>
                    <Link
                      href={`${BASE}/cases/${amlCase.id}`}
                      className="tabular font-medium text-fg underline-offset-2 hover:underline"
                    >
                      {amlCase.reference}
                    </Link>
                    <p className="max-w-xs truncate text-xs text-fg-muted">{amlCase.summary}</p>
                  </Td>
                  <Td>{amlCase.subject?.fullName ?? '—'}</Td>
                  <Td>
                    {amlCase.transfer ? (
                      <>
                        <span className="tabular">{amlCase.transfer.reference}</span>{' '}
                        <StatusBadge
                          status={amlCase.transfer.status}
                          label={
                            amlCase.transfer.status === 'ON_HOLD'
                              ? 'On hold'
                              : caseStatusLabel(amlCase.transfer.status)
                          }
                        />
                        <p className="text-xs text-fg-muted">
                          <Money
                            amount={amlCase.transfer.sendAmount}
                            currency={amlCase.transfer.sourceCurrency}
                          />{' '}
                          · {usd(amlCase.transfer.sendAmountUsd)}
                        </p>
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={amlCase.priority} />
                  </Td>
                  <Td>
                    <StatusBadge status={amlCase.status} label={caseStatusLabel(amlCase.status)} />
                  </Td>
                  <Td align="right">{amlCase._count.alerts}</Td>
                  <Td align="right">{amlCase._count.notes}</Td>
                  <Td className="whitespace-nowrap">{formatDate(amlCase.createdAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            hrefFor={(next) => hrefWith(BASE, { tab: 'cases', status: statusFilter, page: next })}
          />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SARs
// ---------------------------------------------------------------------------

export async function SarsSection({
  ctx,
  status,
}: {
  ctx: ActionContext;
  status: string | undefined;
}) {
  const statusFilter = oneOf(['DRAFT', 'FILED'] as const, status);
  const sars = await listSars(ctx, { status: statusFilter });
  return (
    <Card>
      <CardHeader
        title="Suspicious activity reports"
        description="Drafted on a case, then filed with the authority's reference. BI-Rem Lite records the filing; it does not transmit anything to a regulator."
        action={
          <nav aria-label="Filter reports" className="flex gap-1 text-xs">
            {[
              { key: undefined, label: 'All' },
              { key: 'DRAFT', label: 'Drafts' },
              { key: 'FILED', label: 'Filed' },
            ].map((option) => (
              <Link
                key={option.label}
                href={hrefWith(BASE, { tab: 'sars', status: option.key })}
                aria-current={statusFilter === option.key ? 'true' : undefined}
                className="rounded-full border border-border px-2 py-1 text-fg-muted hover:text-fg aria-[current]:bg-accent-soft aria-[current]:text-accent"
              >
                {option.label}
              </Link>
            ))}
          </nav>
        }
      />
      {sars.length === 0 ? (
        <EmptyState title="No report" description="Start a SAR draft from a compliance case." />
      ) : (
        <Table caption="Suspicious activity reports">
          <THead>
            <Tr>
              <Th>Case</Th>
              <Th>Status</Th>
              <Th>Reference</Th>
              <Th>Authority</Th>
              <Th>Narrative</Th>
              <Th>Created</Th>
              <Th>Filed</Th>
            </Tr>
          </THead>
          <TBody>
            {sars.map((sar) => (
              <Tr key={sar.id}>
                <Td>
                  <Link
                    href={`${BASE}/cases/${sar.case.id}`}
                    className="tabular font-medium underline"
                  >
                    {sar.case.reference}
                  </Link>
                </Td>
                <Td>
                  <StatusBadge status={sar.status} />
                </Td>
                <Td className="tabular">{sar.reference ?? '—'}</Td>
                <Td>{sar.regulator ?? '—'}</Td>
                <Td className="max-w-sm truncate text-fg-muted">{sar.narrative}</Td>
                <Td className="whitespace-nowrap">{formatDate(sar.createdAt)}</Td>
                <Td className="whitespace-nowrap">{formatDate(sar.filedAt)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const PARAM_LABELS: Readonly<Record<string, { label: string; hint?: string }>> = {
  thresholdUsd: { label: 'Threshold (USD)', hint: 'Value of one transfer, in US dollars.' },
  maxValueUsd: { label: 'Maximum value (USD)', hint: 'Total sent within the window.' },
  windowHours: { label: 'Window (hours)' },
  maxCount: { label: 'Maximum transfers in the window' },
  bandPercent: {
    label: 'Band (% of the threshold)',
    hint: 'Transfers between this share and 100% of the threshold count as "just under".',
  },
  minCount: { label: 'Transfers needed to trigger' },
  accountAgeDays: { label: 'Account age (days)' },
  listType: { label: 'Screening list' },
};

function describeParams(params: unknown): string {
  if (params === null || typeof params !== 'object') return '—';
  return Object.entries(params as Record<string, unknown>)
    .map(([key, value]) => {
      const label = PARAM_LABELS[key]?.label ?? key;
      if (key.endsWith('Usd') && typeof value === 'string' && /^\d+$/.test(value)) {
        return `${label}: ${toMajorString(BigInt(value), 'USD')}`;
      }
      return `${label}: ${typeof value === 'string' || typeof value === 'number' ? value : '?'}`;
    })
    .join(' · ');
}

export async function RulesSection({
  ctx,
  canWrite,
  editId,
  saved,
}: {
  ctx: ActionContext;
  canWrite: boolean;
  editId: string | undefined;
  saved: string | undefined;
}) {
  const rules = await listAmlRules(ctx);
  const editing = canWrite ? rules.find((rule) => rule.id === editId) : undefined;
  const params =
    editing && editing.params !== null && typeof editing.params === 'object'
      ? Object.entries(editing.params as Record<string, unknown>)
      : [];
  return (
    <>
      {/* Only a real rule code is echoed back from the URL. */}
      {saved && rules.some((rule) => rule.code === saved) ? (
        <Alert tone="success" className="mb-5">
          Rule {saved} saved. It applies to the next transfer screened.
        </Alert>
      ) : null}
      {editing ? (
        <Card className="mb-5">
          <CardHeader
            title={`Edit ${editing.code} — ${editing.name}`}
            description={editing.description}
          />
          <CardBody>
            <ActionForm action={updateAmlRuleAction} className="space-y-4">
              <input type="hidden" name="ruleId" value={editing.id} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Select
                  name="action"
                  label="Action"
                  required
                  defaultValue={editing.action}
                  hint="Hold reserves the funds until compliance decides; flag only raises an alert."
                  options={[
                    { value: 'FLAG', label: 'Flag' },
                    { value: 'HOLD', label: 'Hold the transfer' },
                  ]}
                />
                <Select
                  name="severity"
                  label="Severity"
                  required
                  defaultValue={editing.severity}
                  options={enumOptions(SEVERITIES, humanize)}
                />
                <Input
                  name="score"
                  type="number"
                  label="Score"
                  hint="Added to the transfer's AML score (0–100)."
                  required
                  min={0}
                  max={100}
                  defaultValue={editing.score}
                />
                {params.map(([key, value]) => {
                  const meta = PARAM_LABELS[key] ?? { label: key };
                  if (key === 'listType') {
                    return (
                      <Select
                        key={key}
                        name={`param.${key}`}
                        label={meta.label}
                        required
                        defaultValue={typeof value === 'string' ? value : undefined}
                        options={[
                          { value: 'SANCTION', label: 'Sanctions' },
                          { value: 'PEP', label: 'Politically exposed persons' },
                        ]}
                      />
                    );
                  }
                  const isUsd = key.endsWith('Usd');
                  const text =
                    isUsd && typeof value === 'string' && /^\d+$/.test(value)
                      ? toMajorString(BigInt(value), 'USD')
                      : typeof value === 'number' || typeof value === 'string'
                        ? String(value)
                        : '';
                  return (
                    <Input
                      key={key}
                      name={`param.${key}`}
                      label={meta.label}
                      hint={meta.hint}
                      required
                      inputMode={isUsd ? 'decimal' : 'numeric'}
                      defaultValue={text}
                    />
                  );
                })}
              </div>
              <Checkbox name="enabled" label="Rule enabled" defaultChecked={editing.enabled} />
              <FormMessage />
              <FormActions>
                <SubmitButton pendingLabel="Saving…">Save rule</SubmitButton>
                <LinkButton href={`${BASE}?tab=rules`} variant="ghost">
                  Cancel
                </LinkButton>
              </FormActions>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader
          title="AML rules"
          description="A transfer is held when a triggered rule's action is Hold, or when the summed score reaches the hold threshold."
        />
        <Table caption="AML rules">
          <THead>
            <Tr>
              <Th>Rule</Th>
              <Th>Parameters</Th>
              <Th>Action</Th>
              <Th>Severity</Th>
              <Th align="right">Score</Th>
              <Th>State</Th>
              {canWrite ? <Th>Actions</Th> : null}
            </Tr>
          </THead>
          <TBody>
            {rules.map((rule) => (
              <Tr key={rule.id} data-rule={rule.code}>
                <Td>
                  <span className="font-medium text-fg">
                    <code className="text-xs">{rule.code}</code> {rule.name}
                  </span>
                  <p className="max-w-sm text-xs text-fg-muted">{rule.description}</p>
                </Td>
                <Td className="max-w-xs text-xs text-fg-muted">{describeParams(rule.params)}</Td>
                <Td>
                  <StatusBadge status={rule.action} />
                </Td>
                <Td>
                  <StatusBadge status={rule.severity} />
                </Td>
                <Td align="right">{rule.score}</Td>
                <Td>
                  <Badge tone={rule.enabled ? 'success' : 'neutral'}>
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </Td>
                {canWrite ? (
                  <Td>
                    <div className="flex flex-wrap items-start gap-2">
                      <LinkButton
                        href={`${BASE}?tab=rules&edit=${rule.id}`}
                        variant="secondary"
                        size="sm"
                      >
                        Edit<span className="sr-only"> {rule.code}</span>
                      </LinkButton>
                      <ActionButton
                        action={toggleAmlRuleAction}
                        fields={{ ruleId: rule.id, enabled: rule.enabled ? 'false' : 'true' }}
                        variant="ghost"
                        confirm={
                          rule.enabled
                            ? `Disable ${rule.code}? Transfers will no longer be screened by this rule.`
                            : undefined
                        }
                      >
                        {rule.enabled ? 'Disable' : 'Enable'}
                        <span className="sr-only"> {rule.code}</span>
                      </ActionButton>
                    </div>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screening list
// ---------------------------------------------------------------------------

export async function ScreeningSection({
  ctx,
  canWrite,
  type,
  search,
}: {
  ctx: ActionContext;
  canWrite: boolean;
  type: 'SANCTION' | 'PEP' | undefined;
  search: string | undefined;
}) {
  const entries = await listSanctionsEntries(ctx, { type, search });
  return (
    <>
      <Alert tone="warning" title="Demo data" className="mb-5">
        This list is fictional and exists to demonstrate name screening. It is not a real sanctions
        or PEP list.
      </Alert>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <FilterBar
            action={BASE}
            hidden={{ tab: 'screening' }}
            resetHref={`${BASE}?tab=screening`}
          >
            <Input name="q" type="search" label="Name" defaultValue={search} />
            <Select
              name="type"
              label="List type"
              placeholder="Sanctions and PEP"
              defaultValue={type}
              options={[
                { value: 'SANCTION', label: 'Sanctions' },
                { value: 'PEP', label: 'PEP' },
              ]}
            />
          </FilterBar>
          {entries.length === 0 ? (
            <EmptyState title="No entry matches" />
          ) : (
            <Table caption="Screening list entries">
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>List</Th>
                  <Th>Country</Th>
                  <Th>State</Th>
                  {canWrite ? <Th>Actions</Th> : null}
                </Tr>
              </THead>
              <TBody>
                {entries.map((entry) => (
                  <Tr key={entry.id}>
                    <Td>
                      <span className="font-medium text-fg">{entry.name}</span>
                      {entry.aliases.length > 0 ? (
                        <p className="text-xs text-fg-muted">also: {entry.aliases.join(', ')}</p>
                      ) : null}
                      {entry.notes ? <p className="text-xs text-fg-subtle">{entry.notes}</p> : null}
                    </Td>
                    <Td>
                      <Badge tone={entry.type === 'SANCTION' ? 'danger' : 'warning'}>
                        {entry.type === 'SANCTION' ? 'Sanction' : 'PEP'}
                      </Badge>
                    </Td>
                    <Td>{entry.listName}</Td>
                    <Td>{entry.countryCode ?? '—'}</Td>
                    <Td>
                      <Badge tone={entry.active ? 'success' : 'neutral'}>
                        {entry.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                    {canWrite ? (
                      <Td>
                        <ActionButton
                          action={setSanctionsEntryActiveAction}
                          fields={{ entryId: entry.id, active: entry.active ? 'false' : 'true' }}
                          variant="ghost"
                        >
                          {entry.active ? 'Deactivate' : 'Activate'}
                          <span className="sr-only"> {entry.name}</span>
                        </ActionButton>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        {canWrite ? (
          <Card>
            <CardHeader
              title="Add an entry"
              description="New names are screened from the next transfer."
            />
            <CardBody>
              <ActionForm action={addSanctionsEntryAction} className="space-y-3">
                <Input name="name" label="Full name" required minLength={3} maxLength={160} />
                <Select
                  name="type"
                  label="Type"
                  required
                  defaultValue="SANCTION"
                  options={[
                    { value: 'SANCTION', label: 'Sanctions' },
                    { value: 'PEP', label: 'Politically exposed person' },
                  ]}
                />
                <Input
                  name="listName"
                  label="List name"
                  required
                  defaultValue="DEMO-MANUAL (fictional)"
                  maxLength={80}
                />
                <Textarea name="aliases" label="Aliases" hint="One per line (up to 10)." rows={2} />
                <Input name="countryCode" label="Country code" maxLength={2} placeholder="CM" />
                <Input name="notes" label="Notes" maxLength={500} />
                <FormMessage />
                <SubmitButton size="sm" pendingLabel="Adding…">
                  Add entry
                </SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
