import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PartnerActionButton } from '@/components/partner/action-button';
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Money,
  PageHeader,
  SimulatedBadge,
  StatusBadge,
} from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';
import { AppError } from '@/server/errors';
import { getTransferDetail } from '@/server/transfers';

import { TRANSFER_TYPE_LABELS, getPartnerPage } from '../../_lib/partner';
import { refreshTransferAction } from '../../actions';

export const metadata: Metadata = { title: 'Transaction' };

const idSchema = z.union([z.uuid(), z.string().regex(/^[A-Za-z0-9]{6,32}$/)]);

/** One transfer with its timeline. `getTransferDetail` answers NOT_FOUND for anyone else's. */
export default async function PartnerTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { ctx } = await getPartnerPage();
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  let detail;
  try {
    detail = await getTransferDetail(ctx, parsed.data);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { transfer, perspective, events, provider } = detail;
  const sent = perspective === 'SENDER';
  const international = transfer.sourceCurrency !== transfer.targetCurrency;

  return (
    <>
      <PageHeader
        back={{ href: '/partner/transactions', label: 'Transactions' }}
        title={
          <>
            <span className="font-mono">{transfer.reference}</span>
          </>
        }
        description={`${TRANSFER_TYPE_LABELS[transfer.type] ?? transfer.type} · ${sent ? 'sent' : 'received'} ${formatDateTime(transfer.createdAt)}`}
        actions={<StatusBadge status={transfer.status} />}
      />

      {transfer.status === 'ON_HOLD' ? (
        <Alert tone="warning" title="Held for compliance review" className="mb-4">
          The funds are reserved. BI-Rem compliance will release the transfer or reject it and
          refund you; you are notified by webhook (
          <code className="font-mono">transfer.completed</code> or{' '}
          <code className="font-mono">transfer.rejected</code>).
        </Alert>
      ) : null}
      {transfer.status === 'FAILED' || transfer.status === 'REJECTED' ? (
        <Alert tone="danger" title="Not delivered — refunded" className="mb-4">
          {transfer.failureReason ?? 'The transfer could not be completed.'}
          {sent ? ' The full amount was returned to your wallet.' : ''}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                ...(sent
                  ? [
                      {
                        label: 'You sent',
                        value: (
                          <Money amount={transfer.sendAmount} currency={transfer.sourceCurrency} />
                        ),
                      },
                      {
                        label: 'Fee',
                        value: (
                          <Money amount={transfer.feeAmount} currency={transfer.sourceCurrency} />
                        ),
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
                    ]
                  : []),
                {
                  label: sent ? 'Recipient gets' : 'You received',
                  value: (
                    <Money
                      amount={transfer.receiveAmount}
                      currency={transfer.targetCurrency}
                      className="font-semibold"
                    />
                  ),
                },
                ...(sent && international
                  ? [
                      {
                        label: 'Exchange rate',
                        value: `1 ${transfer.sourceCurrency} = ${transfer.customerRate.toString()} ${transfer.targetCurrency}`,
                      },
                    ]
                  : []),
                sent
                  ? {
                      label: 'Recipient',
                      value: (
                        <>
                          {transfer.recipientName}
                          <span className="block text-xs text-fg-subtle">
                            {transfer.recipientAccount}
                          </span>
                        </>
                      ),
                    }
                  : { label: 'From', value: transfer.senderName },
                {
                  label: 'Route',
                  value: `${transfer.sourceCountry} → ${transfer.targetCountry} · ${
                    transfer.deliveryMethod === 'MOBILE_MONEY' ? 'mobile money' : 'BI-Rem wallet'
                  }`,
                },
                ...(provider
                  ? [
                      {
                        label: 'Provider',
                        value: (
                          <span className="flex flex-wrap items-center gap-1.5">
                            {provider.name}
                            {provider.simulated ? <SimulatedBadge /> : null}
                          </span>
                        ),
                      },
                    ]
                  : []),
                ...(sent ? [{ label: 'Channel', value: humanize(transfer.channel) }] : []),
                ...(transfer.note ? [{ label: 'Note', value: transfer.note }] : []),
                ...(transfer.completedAt
                  ? [{ label: 'Completed', value: formatDateTime(transfer.completedAt) }]
                  : []),
              ]}
            />
            {sent && transfer.status === 'PROCESSING' && transfer.providerId ? (
              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-2 text-sm text-fg-muted">
                  The payout is pending at the provider. It completes by itself when the provider
                  calls back; you can also ask for its status now.
                </p>
                <PartnerActionButton
                  action={refreshTransferAction}
                  fields={{ id: transfer.id }}
                  pendingLabel="Checking…"
                  showSuccess
                >
                  Check status at provider
                </PartnerActionButton>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Timeline" description="Times are UTC" />
          <CardBody>
            {events.length === 0 ? (
              <p className="text-sm text-fg-muted">No events to show.</p>
            ) : (
              <ol className="space-y-4">
                {events.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-2.5 shrink-0 rounded-full bg-accent"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">{event.message}</p>
                      <p className="text-xs text-fg-subtle">
                        {humanize(event.type)} ·{' '}
                        <time dateTime={event.createdAt.toISOString()}>
                          {formatDateTime(event.createdAt)}
                        </time>
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
