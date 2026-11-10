import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import {
  ActionForm,
  Alert,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  FormMessage,
  LinkButton,
  Money,
  PageHeader,
  SimulatedBadge,
  StatusBadge,
  SubmitButton,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { listCountries } from '@/server/countries';
import { formatRate, parseRate } from '@/server/money';
import { getTransferDetail } from '@/server/transfers';

import {
  PURPOSE_LABELS,
  SOURCE_OF_FUNDS_LABELS,
  labelFor,
  transferKindLabel,
} from '../../_lib/labels';
import { type SearchParams, orNotFound, readSearchParams, uuidParam } from '../../_lib/page';
import { describeOutcome } from '../../_lib/send';
import { EVENT_LABELS, orderTimeline } from '../../_lib/timeline';
import { refreshTransferAction } from '../actions';

export const metadata: Metadata = { title: 'Transfer' };

const EVENT_TONES: Readonly<Record<string, string>> = {
  COMPLETED: 'bg-success',
  FAILED: 'bg-danger',
  REJECTED: 'bg-danger',
  HELD: 'bg-gold-500',
  REVERSED: 'bg-gold-500',
};

/** Tracking page of one transfer: where it stands, its timeline, the amounts and the receipt. */
export default async function TransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { ctx } = await getPageContext('CUSTOMER');
  const id = uuidParam((await params).id);
  const query = await readSearchParams(searchParams);
  const [detail, countries] = await Promise.all([
    orNotFound(() => getTransferDetail(ctx, id)),
    listCountries(),
  ]);
  const { transfer, perspective, provider } = detail;
  const events = orderTimeline(detail.events);

  const topUp = transfer.type === 'TOPUP';
  const kind = transferKindLabel(transfer.type, transfer.deliveryMethod);
  const received = perspective === 'RECIPIENT';
  const crossCurrency = transfer.sourceCurrency !== transfer.targetCurrency;
  const outcome = describeOutcome({ ...transfer, perspective });
  const countryName = (code: string): string =>
    countries.find((country) => country.code === code)?.name ?? code;
  const canRefresh = transfer.status === 'PROCESSING' && !received && provider !== null;

  const amounts: Array<{ label: string; value: ReactNode; strong?: boolean }> = [];
  if (topUp) {
    amounts.push(
      {
        label: 'Collected from mobile money',
        value: <Money amount={transfer.totalDebit} currency={transfer.sourceCurrency} />,
      },
      {
        label: 'Fee',
        value: <Money amount={transfer.feeAmount} currency={transfer.sourceCurrency} />,
      },
      {
        label: 'Credited to your wallet',
        value: <Money amount={transfer.receiveAmount} currency={transfer.targetCurrency} />,
        strong: true,
      },
    );
  } else if (received) {
    amounts.push({
      label: 'Amount received',
      value: <Money amount={transfer.receiveAmount} currency={transfer.targetCurrency} />,
      strong: true,
    });
  } else {
    amounts.push(
      {
        label: 'Amount sent',
        value: <Money amount={transfer.sendAmount} currency={transfer.sourceCurrency} />,
      },
      {
        label: 'Fee',
        value: <Money amount={transfer.feeAmount} currency={transfer.sourceCurrency} />,
      },
      {
        label: outcome.fundsReturned ? 'Total (returned to your wallet)' : 'Total debited',
        value: <Money amount={transfer.totalDebit} currency={transfer.sourceCurrency} />,
        strong: true,
      },
    );
    if (crossCurrency) {
      amounts.push({
        label: 'Exchange rate (locked)',
        value: (
          <span className="tabular">
            1 {transfer.sourceCurrency} = {formatRate(parseRate(transfer.customerRate), 4)}{' '}
            {transfer.targetCurrency}
          </span>
        ),
      });
    }
    amounts.push({
      label: transfer.status === 'COMPLETED' ? 'Recipient got' : 'Recipient gets',
      value: <Money amount={transfer.receiveAmount} currency={transfer.targetCurrency} />,
      strong: true,
    });
  }

  const details: Array<{ label: string; value: ReactNode }> = [
    { label: 'Reference', value: <span className="font-mono">{transfer.reference}</span> },
    { label: 'Type', value: kind },
    { label: 'From', value: transfer.senderName },
    { label: 'To', value: transfer.recipientName },
  ];
  if (!received) details.push({ label: 'Account', value: transfer.recipientAccount });
  if (provider) {
    details.push({
      label: 'Operator',
      value: (
        <span className="flex flex-wrap items-center gap-2">
          {provider.name}
          {provider.simulated ? <SimulatedBadge /> : null}
        </span>
      ),
    });
  }
  details.push({
    label: 'Route',
    value:
      transfer.sourceCountry === transfer.targetCountry
        ? countryName(transfer.sourceCountry)
        : `${countryName(transfer.sourceCountry)} → ${countryName(transfer.targetCountry)}`,
  });
  if (transfer.purpose) {
    details.push({ label: 'Purpose', value: labelFor(PURPOSE_LABELS, transfer.purpose) });
  }
  if (transfer.sourceOfFunds) {
    details.push({
      label: 'Source of funds',
      value: labelFor(SOURCE_OF_FUNDS_LABELS, transfer.sourceOfFunds),
    });
  }
  if (transfer.note && !received) details.push({ label: 'Note', value: transfer.note });
  details.push({ label: 'Created', value: formatDateTime(transfer.createdAt) });
  if (transfer.completedAt) {
    details.push({ label: 'Completed', value: formatDateTime(transfer.completedAt) });
  }
  if (transfer.providerRef && !received) {
    details.push({
      label: 'Operator reference',
      value: <span className="break-all font-mono text-xs">{transfer.providerRef}</span>,
    });
  }

  return (
    <>
      <PageHeader
        back={{ href: '/app/transfers', label: 'Transfers' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {topUp
              ? 'Top-up'
              : received
                ? 'Money received'
                : `Transfer to ${transfer.recipientName}`}
            <StatusBadge status={transfer.status} />
          </span>
        }
        description={`${kind} · ${transfer.reference}`}
        actions={
          <>
            <LinkButton href={`/app/transfers/${transfer.id}/receipt`} variant="secondary">
              Receipt
            </LinkButton>
            <a
              href={`/app/transfers/${transfer.id}/receipt/pdf`}
              download
              className="inline-flex h-11 items-center justify-center rounded-lg border border-border-strong bg-surface-raised px-4 text-sm font-medium text-fg hover:bg-surface-muted"
            >
              Download PDF
            </a>
          </>
        }
      />

      <div className="space-y-4 lg:space-y-6">
        {query.replayed ? (
          <Alert tone="info" title="Already submitted">
            This request had already been received, so it was not sent a second time. This is the
            original transaction.
          </Alert>
        ) : null}

        <Alert tone={outcome.tone} title={outcome.title}>
          {outcome.body}
        </Alert>

        {canRefresh ? (
          <Card padded>
            <ActionForm action={refreshTransferAction} className="space-y-3">
              <input type="hidden" name="id" value={transfer.id} />
              <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                Ask {provider.name} for the latest status of this {topUp ? 'collection' : 'payout'}.
                {provider.simulated ? <SimulatedBadge /> : null}
              </p>
              <FormMessage />
              <SubmitButton variant="secondary" pendingLabel="Asking the operator…">
                Check status
              </SubmitButton>
            </ActionForm>
          </Card>
        ) : null}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-6">
          <Card>
            <CardHeader title="Tracking" description="What happened, in order." />
            <CardBody>
              {events.length === 0 ? (
                <p className="text-sm text-fg-muted">No tracking events yet.</p>
              ) : (
                <ol aria-label="Tracking timeline" className="relative space-y-5">
                  {events.map((event, index) => (
                    <li key={event.id} className="relative flex gap-3">
                      {index < events.length - 1 ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-[0.4375rem] top-4 h-full w-px bg-border"
                        />
                      ) : null}
                      <span
                        aria-hidden="true"
                        className={`relative mt-1 size-3.5 shrink-0 rounded-full ring-4 ring-surface-raised ${EVENT_TONES[event.type] ?? 'bg-accent'}`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-fg">
                          {labelFor(EVENT_LABELS, event.type)}
                        </p>
                        <p className="text-sm text-fg-muted">{event.message}</p>
                        <p className="mt-0.5 text-xs text-fg-subtle">
                          {formatDateTime(event.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          <div className="space-y-4 lg:space-y-6">
            <Card>
              <CardHeader title="Amounts" />
              <CardBody>
                <dl className="divide-y divide-border text-sm">
                  {amounts.map((row) => (
                    <div key={row.label} className="flex items-start justify-between gap-4 py-2.5">
                      <dt className="text-fg-muted">{row.label}</dt>
                      <dd className={`text-right text-fg ${row.strong ? 'font-semibold' : ''}`}>
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Details" />
              <CardBody>
                <DescriptionList items={details} />
              </CardBody>
            </Card>
          </div>
        </div>

        {!received && !topUp ? (
          <div className="flex flex-wrap gap-3">
            <LinkButton
              href={
                transfer.beneficiaryId
                  ? `/app/send?beneficiary=${transfer.beneficiaryId}`
                  : '/app/send'
              }
              variant="secondary"
            >
              Send again
            </LinkButton>
          </div>
        ) : null}
      </div>
    </>
  );
}
