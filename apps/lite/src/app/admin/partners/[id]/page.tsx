import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ActionButton } from '@/components/admin/action-button';
import { type SearchParams, flattenParams } from '@/components/admin/helpers';
import { Notice } from '@/components/admin/notice';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  FormMessage,
  Input,
  Money,
  PageHeader,
  Stat,
  StatGrid,
  StatusBadge,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatBps, formatDate, formatDateTime, humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { isAppError } from '@/server/errors';
import { getPartnerDashboard, listSettlements } from '@/server/partners';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

import {
  reviewPartnerAction,
  runSettlementAction,
  setCommissionAction,
  setPartnerStatusAction,
} from '../actions';

export const metadata: Metadata = { title: 'Partner' };

const statusLabel = (status: string): string | undefined =>
  status === 'REJECTED' ? 'Rejected' : undefined;

/** One partner: profile, wallets, commission, settlements run, status. */
export default async function PartnerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const dashboard = await getPartnerDashboard(ctx, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const [settlements, query] = await Promise.all([
    listSettlements(ctx, { partnerId: id, limit: 20 }),
    searchParams.then(flattenParams),
  ]);
  const { partner } = dashboard;
  const canWrite = roleHasPermission(user.role, 'partners:write');
  const canSettle = roleHasPermission(user.role, 'settlements:write');
  const accrued = dashboard.commissions.filter((row) => row.accrued > 0n);

  return (
    <>
      <PageHeader
        back={{ href: '/admin/partners', label: 'Partners' }}
        title={partner.name}
        description={`${humanize(partner.type)} · code ${partner.code} · ${partner.countryCode} · ${partner.currency}`}
        actions={<StatusBadge status={partner.status} label={statusLabel(partner.status)} />}
      />
      <Notice code={query.notice} />
      {query.created ? (
        <Alert tone="success" className="mb-5">
          Partner created and active. Its code is <strong>{partner.code}</strong>.
        </Alert>
      ) : null}

      <StatGrid>
        <Stat
          label="Commission rate"
          value={formatBps(partner.commissionBps)}
          hint={`${partner.commissionBps} basis points`}
        />
        <Stat label="Active API keys" value={dashboard.activeApiKeys} />
        <Stat label="Webhook endpoints" value={dashboard.activeWebhookEndpoints} />
        <Stat
          label="Webhook deliveries (30 d)"
          value={dashboard.webhookDeliveries.DELIVERED ?? 0}
          hint={`${dashboard.webhookDeliveries.FAILED ?? 0} failed`}
        />
      </StatGrid>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Wallets and commission" />
            {dashboard.wallets.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">
                  No wallet yet — one is created when the application is approved.
                </p>
              </CardBody>
            ) : (
              <Table caption="Partner wallets and commission by currency">
                <THead>
                  <Tr>
                    <Th>Currency</Th>
                    <Th align="right">Wallet balance</Th>
                    <Th align="right">Accrued (unpaid)</Th>
                    <Th align="right">Settled</Th>
                    {canSettle ? <Th>Settlement run</Th> : null}
                  </Tr>
                </THead>
                <TBody>
                  {dashboard.wallets.map((wallet) => {
                    const summary = dashboard.commissions.find(
                      (row) => row.currency === wallet.currency,
                    );
                    return (
                      <Tr key={wallet.id} data-wallet={wallet.currency}>
                        <Td className="font-medium">
                          {wallet.currency} <StatusBadge status={wallet.status} />
                        </Td>
                        <Td align="right">
                          <Money amount={wallet.balance} currency={wallet.currency} />
                        </Td>
                        <Td align="right">
                          <Money amount={summary?.accrued ?? 0n} currency={wallet.currency} />
                          <p className="text-xs text-fg-muted">
                            {summary?.accruedCount ?? 0} commission
                            {summary?.accruedCount === 1 ? '' : 's'}
                          </p>
                        </Td>
                        <Td align="right">
                          <Money amount={summary?.settled ?? 0n} currency={wallet.currency} />
                        </Td>
                        {canSettle ? (
                          <Td>
                            {(summary?.accrued ?? 0n) > 0n && partner.status === 'ACTIVE' ? (
                              <ActionButton
                                action={runSettlementAction}
                                fields={{ partnerId: partner.id, currency: wallet.currency }}
                                variant="primary"
                                pendingLabel="Settling…"
                                confirm={`Pay the accrued ${wallet.currency} commission into ${partner.name}'s wallet and mark it paid?`}
                              >
                                Run and mark paid
                              </ActionButton>
                            ) : (
                              <span className="text-xs text-fg-muted">Nothing to settle</span>
                            )}
                          </Td>
                        ) : null}
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
            {accrued.some(
              (row) => !dashboard.wallets.some((wallet) => wallet.currency === row.currency),
            ) ? (
              <CardBody className="border-t border-border text-sm text-fg-muted">
                Commission is also accrued in a currency without a wallet; the wallet is created by
                the first settlement run.
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Settlements"
              description="Each run posts one journal: commission payable → partner wallet."
            />
            {settlements.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">
                  No settlement has been run for this partner.
                </p>
              </CardBody>
            ) : (
              <Table caption="Settlements of this partner">
                <THead>
                  <Tr>
                    <Th>Reference</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right">Commissions</Th>
                    <Th>Status</Th>
                    <Th>Paid</Th>
                  </Tr>
                </THead>
                <TBody>
                  {settlements.map((settlement) => (
                    <Tr key={settlement.id}>
                      <Td className="tabular font-medium">{settlement.reference}</Td>
                      <Td align="right">
                        <Money amount={settlement.amount} currency={settlement.currency} />
                      </Td>
                      <Td align="right">{settlement.commissionCount}</Td>
                      <Td>
                        <StatusBadge status={settlement.status} />
                      </Td>
                      <Td className="whitespace-nowrap">{formatDateTime(settlement.paidAt)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Activity, last 30 days"
              action={
                <Link
                  href={`/admin/transfers?partner=${partner.id}`}
                  className="text-sm font-medium text-accent underline"
                >
                  All transfers
                </Link>
              }
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(
                [
                  ['Received', dashboard.last30Days.received],
                  ['Sent (API disbursements)', dashboard.last30Days.sent],
                ] as const
              ).map(([label, rows]) => (
                <div key={label}>
                  <p className="text-sm font-medium text-fg">{label}</p>
                  {rows.length === 0 ? (
                    <p className="text-sm text-fg-muted">Nothing in this period.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {rows.map((row) => (
                        <li key={row.currency} className="flex justify-between gap-3">
                          <span className="text-fg-muted">{row.count} transfers</span>
                          <Money amount={row.amount} currency={row.currency} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Profile" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Legal name', value: partner.legalName ?? '—' },
                  { label: 'Contact', value: partner.contactEmail },
                  { label: 'Phone', value: partner.contactPhone ?? '—' },
                  { label: 'Website', value: partner.website ?? '—' },
                  { label: 'Description', value: partner.description ?? '—' },
                  { label: 'Applied', value: formatDate(partner.createdAt) },
                  { label: 'Approved', value: formatDate(partner.approvedAt) },
                  ...(partner.reviewNote
                    ? [{ label: 'Review note', value: partner.reviewNote }]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Users" />
            <CardBody>
              {partner.users.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  No login — this partner is operated through API keys or by staff.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {partner.users.map((partnerUser) => (
                    <li key={partnerUser.id} className="flex items-start justify-between gap-2">
                      <span>
                        <Link
                          href={`/admin/customers/${partnerUser.id}`}
                          className="font-medium underline"
                        >
                          {partnerUser.fullName}
                        </Link>
                        <span className="block text-xs text-fg-muted">{partnerUser.email}</span>
                      </span>
                      <StatusBadge status={partnerUser.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {canWrite && partner.status === 'PENDING' ? (
            <Card>
              <CardHeader title="Review application" />
              <CardBody className="space-y-4">
                <ActionForm action={reviewPartnerAction} className="space-y-3">
                  <input type="hidden" name="partnerId" value={partner.id} />
                  <input type="hidden" name="decision" value="APPROVE" />
                  <Input
                    name="commissionBps"
                    type="number"
                    label="Commission (bps)"
                    min={0}
                    max={1000}
                    defaultValue={partner.commissionBps}
                  />
                  <FormMessage />
                  <SubmitButton size="sm" pendingLabel="Approving…">
                    Approve
                  </SubmitButton>
                </ActionForm>
                <ActionForm
                  action={reviewPartnerAction}
                  className="space-y-3 border-t border-border pt-4"
                >
                  <input type="hidden" name="partnerId" value={partner.id} />
                  <input type="hidden" name="decision" value="REJECT" />
                  <Input name="note" label="Reason (sent to the applicant)" required />
                  <FormMessage />
                  <SubmitButton size="sm" variant="danger" pendingLabel="Rejecting…">
                    Reject
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {canWrite && (partner.status === 'ACTIVE' || partner.status === 'SUSPENDED') ? (
            <Card>
              <CardHeader
                title="Commission and status"
                description="A new rate applies to transfers created from now on."
              />
              <CardBody className="space-y-4">
                <ActionForm action={setCommissionAction} className="space-y-3">
                  <input type="hidden" name="partnerId" value={partner.id} />
                  <Input
                    name="commissionBps"
                    type="number"
                    label="Commission (basis points)"
                    required
                    min={0}
                    max={1000}
                    defaultValue={partner.commissionBps}
                  />
                  <FormMessage />
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
                    Save commission
                  </SubmitButton>
                </ActionForm>
                <div className="border-t border-border pt-4">
                  <p className="mb-2 text-sm text-fg-muted">
                    <Badge tone={partner.status === 'ACTIVE' ? 'success' : 'danger'}>
                      {humanize(partner.status)}
                    </Badge>{' '}
                    {partner.status === 'ACTIVE'
                      ? 'Suspending blocks the partner portal and its API keys.'
                      : 'Reactivating restores portal and API access.'}
                  </p>
                  {partner.status === 'ACTIVE' ? (
                    <ActionButton
                      action={setPartnerStatusAction}
                      fields={{ partnerId: partner.id, status: 'SUSPENDED' }}
                      variant="danger"
                      confirm={`Suspend ${partner.name}?`}
                    >
                      Suspend partner
                    </ActionButton>
                  ) : (
                    <ActionButton
                      action={setPartnerStatusAction}
                      fields={{ partnerId: partner.id, status: 'ACTIVE' }}
                      variant="primary"
                    >
                      Reactivate partner
                    </ActionButton>
                  )}
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
