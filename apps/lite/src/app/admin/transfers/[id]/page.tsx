import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ActionButton } from '@/components/admin/action-button';
import { type SearchParams, flattenParams, usd } from '@/components/admin/helpers';
import { JsonView } from '@/components/admin/json-view';
import { Notice } from '@/components/admin/notice';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ConfirmSubmitButton,
  DescriptionList,
  FormMessage,
  Money,
  PageHeader,
  SimulatedBadge,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
} from '@/components/ui';
import { formatBps, formatDateTime, humanize } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { isAppError } from '@/server/errors';
import { formatRate, parseRate } from '@/server/money';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';
import { getTransferCompliance, getTransferDetail, getTransferJournals } from '@/server/transfers';

import { refreshTransferAction, reverseTransferAction } from '../actions';

export const metadata: Metadata = { title: 'Transfer' };

const statusLabel = (status: string): string | undefined =>
  status === 'ON_HOLD' ? 'On hold' : status === 'REJECTED' ? 'Rejected' : undefined;

/** One transfer: amounts, parties, timeline, the ledger journals that moved the money, reversal. */
export default async function TransferDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const { id } = await params;
  const { notice } = flattenParams(await searchParams);
  if (!/^[A-Za-z0-9-]{6,64}$/.test(id)) notFound();
  const detail = await getTransferDetail(ctx, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const { transfer, events, provider } = detail;
  const can = (permission: Parameters<typeof roleHasPermission>[1]) =>
    roleHasPermission(user.role, permission);
  const [journals, compliance] = await Promise.all([
    getTransferJournals(ctx, transfer.id),
    can('aml:read') ? getTransferCompliance(ctx, transfer.id) : null,
  ]);
  const crossCurrency = transfer.sourceCurrency !== transfer.targetCurrency;
  const openCase = compliance?.cases.find(
    (amlCase) => amlCase.status === 'OPEN' || amlCase.status === 'UNDER_REVIEW',
  );

  return (
    <>
      <PageHeader
        back={{ href: '/admin/transfers', label: 'Transfers' }}
        title={transfer.reference}
        description={`${humanize(transfer.type)} · ${humanize(transfer.deliveryMethod)} · created ${formatDateTime(transfer.createdAt)} via ${humanize(transfer.channel)}`}
        actions={<StatusBadge status={transfer.status} label={statusLabel(transfer.status)} />}
      />

      <Notice code={notice} />
      {transfer.status === 'ON_HOLD' ? (
        <Alert tone="warning" title="Held by AML screening" className="mb-5">
          The funds are reserved in the suspense account until compliance releases or rejects the
          transfer.{' '}
          {openCase ? (
            <Link href={`/admin/compliance/cases/${openCase.id}`} className="font-medium underline">
              Open case {openCase.reference}
            </Link>
          ) : null}
        </Alert>
      ) : null}
      {transfer.failureReason ? (
        <Alert tone="danger" title="Failure" className="mb-5">
          {transfer.failureReason}
          {transfer.failureCode ? ` (${transfer.failureCode})` : ''}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Amounts" />
            <CardBody>
              <DescriptionList
                items={[
                  {
                    label: 'Send amount',
                    value: (
                      <Money amount={transfer.sendAmount} currency={transfer.sourceCurrency} />
                    ),
                  },
                  {
                    label: 'Fee',
                    value: <Money amount={transfer.feeAmount} currency={transfer.sourceCurrency} />,
                  },
                  {
                    label: 'Total debited',
                    value: (
                      <Money
                        amount={transfer.totalDebit}
                        currency={transfer.sourceCurrency}
                        className="font-semibold"
                      />
                    ),
                  },
                  {
                    label: 'Recipient gets',
                    value: (
                      <Money
                        amount={transfer.receiveAmount}
                        currency={transfer.targetCurrency}
                        className="font-semibold"
                      />
                    ),
                  },
                  ...(crossCurrency
                    ? [
                        {
                          label: 'Mid rate',
                          value: (
                            <span className="tabular">
                              1 {transfer.sourceCurrency} ={' '}
                              {formatRate(parseRate(transfer.midRate), 4)} {transfer.targetCurrency}
                            </span>
                          ),
                        },
                        {
                          label: 'Customer rate',
                          value: (
                            <span className="tabular">
                              1 {transfer.sourceCurrency} ={' '}
                              {formatRate(parseRate(transfer.customerRate), 4)}{' '}
                              {transfer.targetCurrency} (margin {formatBps(transfer.marginBps)})
                            </span>
                          ),
                        },
                        {
                          label: 'FX margin earned',
                          value: (
                            <Money
                              amount={transfer.fxMarginAmount}
                              currency={transfer.sourceCurrency}
                            />
                          ),
                        },
                      ]
                    : []),
                  { label: 'Value (USD)', value: usd(transfer.sendAmountUsd) },
                  { label: 'Revenue (USD)', value: usd(transfer.revenueUsd) },
                  ...(transfer.commissionAmount > 0n
                    ? [
                        {
                          label: 'Partner commission',
                          value: (
                            <Money
                              amount={transfer.commissionAmount}
                              currency={transfer.sourceCurrency}
                            />
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Ledger journals"
              description="Double-entry postings of this transfer. Each journal balances per currency; nothing is ever edited — a reversal is a new journal."
            />
            {journals.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">
                  No journal has been posted for this transfer.
                </p>
              </CardBody>
            ) : (
              <div className="divide-y divide-border">
                {journals.map((journal) => (
                  <section key={journal.id} aria-label={`${humanize(journal.kind)} journal`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 sm:px-6">
                      <p className="text-sm">
                        <Badge tone="brand">{humanize(journal.kind)}</Badge>{' '}
                        <span className="text-fg">{journal.description}</span>
                      </p>
                      <p className="text-xs text-fg-subtle">{formatDateTime(journal.postedAt)}</p>
                    </div>
                    <Table caption={`Entries of the ${humanize(journal.kind)} journal`}>
                      <THead>
                        <Tr>
                          <Th>Account</Th>
                          <Th>Type</Th>
                          <Th align="right">Debit</Th>
                          <Th align="right">Credit</Th>
                          <Th align="right">Balance after</Th>
                        </Tr>
                      </THead>
                      <TBody>
                        {journal.entries.map((entry) => (
                          <Tr key={entry.id}>
                            <Td>
                              {entry.account.name}
                              <p className="font-mono text-xs text-fg-subtle">
                                {entry.account.code}
                              </p>
                            </Td>
                            <Td>{humanize(entry.account.type)}</Td>
                            <Td align="right">
                              {entry.direction === 'DEBIT' ? (
                                <Money amount={entry.amount} currency={entry.currency} />
                              ) : (
                                ''
                              )}
                            </Td>
                            <Td align="right">
                              {entry.direction === 'CREDIT' ? (
                                <Money amount={entry.amount} currency={entry.currency} />
                              ) : (
                                ''
                              )}
                            </Td>
                            <Td align="right" className="text-fg-muted">
                              <Money amount={entry.balanceAfter} currency={entry.currency} />
                            </Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  </section>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <CardBody>
              <ol className="space-y-4">
                {events.map((event) => (
                  <li key={event.id} className="border-l-2 border-border pl-4">
                    <p className="text-sm font-medium text-fg">
                      {humanize(event.type)}
                      <span className="ml-2 text-xs font-normal text-fg-subtle">
                        {formatDateTime(event.createdAt)}
                      </span>
                    </p>
                    <p className="text-sm text-fg-muted">{event.message}</p>
                    {event.data ? (
                      <details className="mt-1 text-xs text-fg-muted">
                        <summary className="cursor-pointer select-none hover:text-fg">
                          Details
                        </summary>
                        <div className="mt-1">
                          <JsonView label="Event data" value={event.data} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Parties" />
            <CardBody>
              <DescriptionList
                items={[
                  {
                    label: 'Sender',
                    value: transfer.senderUserId ? (
                      <Link
                        href={`/admin/customers/${transfer.senderUserId}`}
                        className="underline"
                      >
                        {transfer.senderName}
                      </Link>
                    ) : transfer.senderPartnerId ? (
                      <Link
                        href={`/admin/partners/${transfer.senderPartnerId}`}
                        className="underline"
                      >
                        {transfer.senderName}
                      </Link>
                    ) : (
                      transfer.senderName
                    ),
                  },
                  {
                    label: 'Recipient',
                    value: transfer.recipientUserId ? (
                      <Link
                        href={`/admin/customers/${transfer.recipientUserId}`}
                        className="underline"
                      >
                        {transfer.recipientName}
                      </Link>
                    ) : (
                      transfer.recipientName
                    ),
                  },
                  {
                    label: 'Account',
                    value: <span className="tabular">{transfer.recipientAccount}</span>,
                  },
                  {
                    label: 'Corridor',
                    value: `${transfer.sourceCountry} → ${transfer.targetCountry}`,
                  },
                  { label: 'Purpose', value: transfer.purpose ? humanize(transfer.purpose) : '—' },
                  {
                    label: 'Source of funds',
                    value: transfer.sourceOfFunds ? humanize(transfer.sourceOfFunds) : '—',
                  },
                  { label: 'Note', value: transfer.note ?? '—' },
                  { label: 'Completed', value: formatDateTime(transfer.completedAt) },
                  ...(transfer.reversedAt
                    ? [{ label: 'Reversed', value: formatDateTime(transfer.reversedAt) }]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          {provider ? (
            <Card>
              <CardHeader
                title="Provider"
                action={provider.simulated ? <SimulatedBadge /> : undefined}
              />
              <CardBody className="space-y-3">
                <DescriptionList
                  items={[
                    {
                      label: 'Provider',
                      value: (
                        <Link href={`/admin/providers/${provider.id}`} className="underline">
                          {provider.name}
                        </Link>
                      ),
                    },
                    {
                      label: 'Provider reference',
                      value: (
                        <span className="font-mono text-xs">{transfer.providerRef ?? '—'}</span>
                      ),
                    },
                  ]}
                />
                {transfer.status === 'PROCESSING' && can('transfers:refresh') ? (
                  <ActionButton
                    action={refreshTransferAction}
                    fields={{ transferId: transfer.id }}
                    pendingLabel="Checking…"
                  >
                    Check status with provider
                  </ActionButton>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {compliance ? (
            <Card>
              <CardHeader title="Compliance" description={`AML score ${transfer.amlScore}`} />
              <CardBody className="space-y-3">
                {compliance.alerts.length === 0 ? (
                  <p className="text-sm text-fg-muted">Screening raised no alert.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {compliance.alerts.map((alert) => (
                      <li key={alert.id} className="flex items-start justify-between gap-2">
                        <span>
                          <code className="text-xs">{alert.ruleCode}</code> {alert.message}
                        </span>
                        <StatusBadge status={alert.status} />
                      </li>
                    ))}
                  </ul>
                )}
                {compliance.cases.map((amlCase) => (
                  <p key={amlCase.id} className="text-sm">
                    <Link
                      href={`/admin/compliance/cases/${amlCase.id}`}
                      className="font-medium text-accent underline"
                    >
                      Case {amlCase.reference}
                    </Link>{' '}
                    <StatusBadge status={amlCase.status} />
                  </p>
                ))}
              </CardBody>
            </Card>
          ) : null}

          {can('transfers:reverse') && transfer.status === 'COMPLETED' ? (
            <Card>
              <CardHeader
                title="Reverse this transfer"
                description="Posts a mirror journal for every journal of the transfer and returns the money to the sender. This cannot be undone."
              />
              <CardBody>
                <ActionForm action={reverseTransferAction} className="space-y-3">
                  <input type="hidden" name="transferId" value={transfer.id} />
                  <Textarea name="reason" label="Reason" rows={3} required minLength={5} />
                  <FormMessage />
                  <ConfirmSubmitButton
                    variant="danger"
                    size="sm"
                    pendingLabel="Reversing…"
                    confirm={`Reverse ${transfer.reference}? Compensating journals will be posted.`}
                  >
                    Reverse transfer
                  </ConfirmSubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
