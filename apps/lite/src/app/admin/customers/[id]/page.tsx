import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ActionButton } from '@/components/admin/action-button';
import { enumOptions, usd } from '@/components/admin/helpers';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  FormMessage,
  Money,
  PageHeader,
  Select,
  SimulatedBadge,
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
import { listAuditLogs } from '@/server/audit';
import { getPageContext } from '@/server/auth/session';
import { isAppError } from '@/server/errors';
import { KYC_TIER_INFO, getLimitOverview } from '@/server/kyc';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';
import { getUserDetail } from '@/server/users';

import {
  assignTierAction,
  recalculateRiskAction,
  setCustomerStatusAction,
  unlockCustomerAction,
} from '../actions';

export const metadata: Metadata = { title: 'Customer' };

const riskFactorSchema = z.array(
  z.object({ code: z.string(), label: z.string(), points: z.number() }),
);

/** Customer 360°: profile, wallets, KYC history, risk profile, transfers and audit trail. */
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, user: viewer } = await getPageContext(...STAFF_ROLES);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const detail = await getUserDetail(ctx, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const { user, transfers, alerts } = detail;
  const can = (permission: Parameters<typeof roleHasPermission>[1]) =>
    roleHasPermission(viewer.role, permission);
  const isCustomer = user.role === 'CUSTOMER';

  const [limits, actorTrail, subjectTrail] = await Promise.all([
    isCustomer ? getLimitOverview(ctx, user.id) : null,
    can('audit:read') ? listAuditLogs(ctx, { actorId: user.id, pageSize: 15 }) : null,
    can('audit:read')
      ? listAuditLogs(ctx, { resourceType: 'user', resourceId: user.id, pageSize: 15 })
      : null,
  ]);
  const trail = [...(actorTrail?.items ?? []), ...(subjectTrail?.items ?? [])]
    .filter((row, index, rows) => rows.findIndex((other) => other.id === row.id) === index)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20);
  const factors = riskFactorSchema.safeParse(user.riskFactors);
  const locked = user.lockedUntil !== null && user.lockedUntil > new Date();

  return (
    <>
      <PageHeader
        back={{ href: '/admin/customers', label: 'Customers' }}
        title={user.fullName}
        description={`${user.email} · ${humanize(user.role)} since ${formatDate(user.createdAt)}`}
        actions={
          <>
            <StatusBadge status={user.status} />
            <StatusBadge
              status={user.kycStatus}
              label={`KYC ${humanize(user.kycStatus).toLowerCase()}`}
            />
            <StatusBadge status={user.riskLevel} label={`${humanize(user.riskLevel)} risk`} />
          </>
        }
      />

      {user.sanctionsMatch || user.pepMatch ? (
        <Alert tone="warning" title="Screening match" className="mb-5">
          {user.sanctionsMatch ? 'The name matches an entry of the demo sanctions list. ' : ''}
          {user.pepMatch ? 'The name matches an entry of the demo PEP list. ' : ''}
          The screening list in BI-Rem Lite is fictional demo data, not a real list.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Profile" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Full name', value: user.fullName },
                  { label: 'E-mail', value: user.email },
                  { label: 'Phone', value: user.phone ?? '—' },
                  {
                    label: 'Country',
                    value: user.country
                      ? `${user.country.name} (${user.country.code}) · ${user.country.currency}`
                      : '—',
                  },
                  { label: 'Date of birth', value: formatDate(user.dateOfBirth) },
                  {
                    label: 'Address',
                    value: [user.addressLine, user.city].filter(Boolean).join(', ') || '—',
                  },
                  { label: 'Occupation', value: user.occupation ?? '—' },
                  {
                    label: 'Two-factor authentication',
                    value: user.mfaEnabled ? 'On' : 'Off',
                  },
                  { label: 'Last sign-in', value: formatDateTime(user.lastLoginAt) },
                  {
                    label: 'Active sessions',
                    value: detail.activeSessions,
                  },
                  ...(user.partner
                    ? [
                        {
                          label: 'Partner',
                          value: (
                            <Link href={`/admin/partners/${user.partner.id}`} className="underline">
                              {user.partner.name} ({user.partner.code})
                            </Link>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Wallets" description="Balances come from the ledger accounts" />
            {user.wallets.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">This account has no wallet.</p>
              </CardBody>
            ) : (
              <Table caption="Wallets">
                <THead>
                  <Tr>
                    <Th>Currency</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th align="right">Balance</Th>
                    <Th>Opened</Th>
                  </Tr>
                </THead>
                <TBody>
                  {user.wallets.map((wallet) => (
                    <Tr key={wallet.id}>
                      <Td className="font-medium">{wallet.currency}</Td>
                      <Td>{humanize(wallet.type)}</Td>
                      <Td>
                        <StatusBadge status={wallet.status} />
                      </Td>
                      <Td align="right">
                        <Money amount={wallet.balance} currency={wallet.currency} />
                      </Td>
                      <Td>{formatDate(wallet.createdAt)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="KYC history"
              description={`Current level: ${KYC_TIER_INFO[user.kycTier].label}`}
            />
            {user.kycCases.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">No verification case has been submitted.</p>
              </CardBody>
            ) : (
              <Table caption="KYC cases">
                <THead>
                  <Tr>
                    <Th>Submitted</Th>
                    <Th>Target</Th>
                    <Th>Vendor</Th>
                    <Th>Vendor decision</Th>
                    <Th>Status</Th>
                    <Th>Decided</Th>
                  </Tr>
                </THead>
                <TBody>
                  {user.kycCases.map((kycCase) => (
                    <Tr key={kycCase.id}>
                      <Td className="whitespace-nowrap">
                        <Link href={`/admin/kyc/${kycCase.id}`} className="font-medium underline">
                          {formatDate(kycCase.submittedAt)}
                        </Link>
                      </Td>
                      <Td>{humanize(kycCase.targetTier)}</Td>
                      <Td>
                        {humanize(kycCase.vendor)} <SimulatedBadge />
                      </Td>
                      <Td>{kycCase.vendorDecision ? humanize(kycCase.vendorDecision) : '—'}</Td>
                      <Td>
                        <StatusBadge status={kycCase.status} />
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(kycCase.decidedAt)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recent transfers"
              description="Sent and received, newest first"
              action={
                <Link
                  href={`/admin/transfers?user=${user.id}`}
                  className="text-sm font-medium text-accent underline"
                >
                  All transfers
                </Link>
              }
            />
            {transfers.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">No transfers yet.</p>
              </CardBody>
            ) : (
              <Table caption="Recent transfers">
                <THead>
                  <Tr>
                    <Th>Reference</Th>
                    <Th>Direction</Th>
                    <Th>Counterparty</Th>
                    <Th align="right">Amount</Th>
                    <Th>Status</Th>
                    <Th>Date</Th>
                  </Tr>
                </THead>
                <TBody>
                  {transfers.map((transfer) => {
                    const sent = transfer.senderUserId === user.id && transfer.type !== 'TOPUP';
                    return (
                      <Tr key={transfer.id}>
                        <Td>
                          <Link
                            href={`/admin/transfers/${transfer.id}`}
                            className="tabular font-medium underline"
                          >
                            {transfer.reference}
                          </Link>
                          <p className="text-xs text-fg-subtle">{humanize(transfer.type)}</p>
                        </Td>
                        <Td>{sent ? 'Sent' : 'Received'}</Td>
                        <Td>{sent ? transfer.recipientName : transfer.senderName}</Td>
                        <Td align="right">
                          <Money
                            amount={sent ? transfer.totalDebit : transfer.receiveAmount}
                            currency={sent ? transfer.sourceCurrency : transfer.targetCurrency}
                          />
                        </Td>
                        <Td>
                          <StatusBadge status={transfer.status} />
                        </Td>
                        <Td className="whitespace-nowrap">{formatDate(transfer.createdAt)}</Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Audit trail"
              description="Actions by this user and actions taken on the account"
            />
            {!can('audit:read') ? (
              <CardBody>
                <p className="text-sm text-fg-muted">
                  The audit trail is visible to administrators and compliance officers.
                </p>
              </CardBody>
            ) : trail.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">No audit entries yet.</p>
              </CardBody>
            ) : (
              <Table caption="Audit trail">
                <THead>
                  <Tr>
                    <Th>When</Th>
                    <Th>Action</Th>
                    <Th>Actor</Th>
                    <Th>Outcome</Th>
                  </Tr>
                </THead>
                <TBody>
                  {trail.map((row) => (
                    <Tr key={row.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(row.createdAt)}</Td>
                      <Td>
                        <code className="text-xs">{row.action}</code>
                      </Td>
                      <Td>{row.actorLabel ?? humanize(row.actorType)}</Td>
                      <Td>
                        <StatusBadge status={row.outcome} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Risk profile"
              description={`Assessed ${formatDateTime(user.riskAssessedAt)}`}
            />
            <CardBody className="space-y-4">
              <div className="flex items-baseline gap-3">
                <span className="tabular text-3xl font-semibold text-fg">{user.riskScore}</span>
                <StatusBadge status={user.riskLevel} label={`${humanize(user.riskLevel)} risk`} />
              </div>
              {factors.success && factors.data.length > 0 ? (
                <ul className="space-y-1.5 text-sm">
                  {factors.data.map((factor) => (
                    <li key={factor.code} className="flex justify-between gap-3">
                      <span className="text-fg">{factor.label}</span>
                      <span className="tabular shrink-0 text-fg-muted">+{factor.points}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-muted">No risk factor recorded.</p>
              )}
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone={user.sanctionsMatch ? 'danger' : 'neutral'}>
                  Sanctions match: {user.sanctionsMatch ? 'yes' : 'no'}
                </Badge>
                <Badge tone={user.pepMatch ? 'warning' : 'neutral'}>
                  PEP match: {user.pepMatch ? 'yes' : 'no'}
                </Badge>
              </div>
              {alerts.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                    Recent AML alerts
                  </p>
                  <ul className="mt-1.5 space-y-1.5 text-sm">
                    {alerts.slice(0, 6).map((alert) => (
                      <li key={alert.id} className="flex items-start justify-between gap-2">
                        <span>
                          <code className="text-xs">{alert.ruleCode}</code> {alert.message}
                        </span>
                        <StatusBadge status={alert.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {isCustomer && (can('aml:write') || can('users:write')) ? (
                <ActionButton
                  action={recalculateRiskAction}
                  fields={{ userId: user.id }}
                  showSuccess
                >
                  Reassess risk now
                </ActionButton>
              ) : null}
            </CardBody>
          </Card>

          {limits ? (
            <Card>
              <CardHeader title="Limits" description={KYC_TIER_INFO[limits.tier].label} />
              <CardBody>
                <DescriptionList
                  items={[
                    { label: 'Per transfer', value: usd(limits.limits.perTransaction) },
                    { label: 'Daily', value: usd(limits.limits.daily) },
                    { label: 'Monthly', value: usd(limits.limits.monthly) },
                    { label: 'Left today', value: usd(limits.remainingToday) },
                    { label: 'Left this month', value: usd(limits.remainingThisMonth) },
                    {
                      label: 'International',
                      value: limits.limits.international ? 'Allowed' : 'Not allowed',
                    },
                  ]}
                />
              </CardBody>
            </Card>
          ) : null}

          {isCustomer && can('kyc:review') ? (
            <Card>
              <CardHeader
                title="Assign KYC tier"
                description="Manual override, e.g. after an offline check. Audited."
              />
              <CardBody>
                <ActionForm action={assignTierAction} className="space-y-3">
                  <input type="hidden" name="userId" value={user.id} />
                  <Select
                    name="tier"
                    label="Tier"
                    required
                    defaultValue={user.kycTier}
                    options={enumOptions(
                      ['TIER_0', 'TIER_1', 'TIER_2'],
                      (tier) => KYC_TIER_INFO[tier as keyof typeof KYC_TIER_INFO].label,
                    )}
                  />
                  <Textarea name="reason" label="Reason" rows={2} required minLength={5} />
                  <FormMessage />
                  <SubmitButton size="sm" pendingLabel="Saving…">
                    Assign tier
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {can('users:write') && user.id !== viewer.id ? (
            <Card>
              <CardHeader
                title={user.status === 'ACTIVE' ? 'Suspend account' : 'Reactivate account'}
                description={
                  user.status === 'ACTIVE'
                    ? 'Blocks sign-in and signs the user out everywhere.'
                    : 'Lets the user sign in again.'
                }
              />
              <CardBody className="space-y-4">
                {user.status === 'CLOSED' ? (
                  <p className="text-sm text-fg-muted">This account is closed.</p>
                ) : (
                  <ActionForm action={setCustomerStatusAction} className="space-y-3">
                    <input type="hidden" name="userId" value={user.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}
                    />
                    <Textarea name="reason" label="Reason" rows={2} required minLength={5} />
                    <FormMessage />
                    <SubmitButton
                      size="sm"
                      variant={user.status === 'ACTIVE' ? 'danger' : 'primary'}
                      pendingLabel="Saving…"
                    >
                      {user.status === 'ACTIVE' ? 'Suspend account' : 'Reactivate account'}
                    </SubmitButton>
                  </ActionForm>
                )}
                {locked ? (
                  <div className="border-t border-border pt-4">
                    <p className="mb-2 text-sm text-fg-muted">
                      Locked after {user.failedLoginCount} failed sign-ins until{' '}
                      {formatDateTime(user.lockedUntil)}.
                    </p>
                    <ActionButton
                      action={unlockCustomerAction}
                      fields={{ userId: user.id }}
                      showSuccess
                    >
                      Clear lockout
                    </ActionButton>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {user.beneficiaries.length > 0 ? (
            <Card>
              <CardHeader title="Beneficiaries" />
              <CardBody>
                <ul className="space-y-2 text-sm">
                  {user.beneficiaries.map((beneficiary) => (
                    <li key={beneficiary.id}>
                      <span className="font-medium text-fg">{beneficiary.fullName}</span>
                      <p className="text-xs text-fg-muted">
                        {humanize(beneficiary.method)} · {beneficiary.countryCode} ·{' '}
                        <span className="tabular">{beneficiary.accountNumber}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
