import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { CashInFlow } from '@/components/partner/cash-in-flow';
import { CopyButton } from '@/components/partner/copy-button';
import { TransactionsTable } from '@/components/partner/transactions-table';
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  LinkButton,
  Money,
  PageHeader,
  Stat,
  StatGrid,
  buttonClasses,
} from '@/components/ui';
import { formatBps, formatDateTime } from '@/lib/format';
import { AppError } from '@/server/errors';
import { getCommissionSummary } from '@/server/partners';
import { type TransferDetail, getTransferDetail, listMyTransfers } from '@/server/transfers';
import { listMyWallets } from '@/server/wallets';

import { getPartnerPage } from '../_lib/partner';
import { confirmCashInAction, previewCashInAction } from '../actions';

export const metadata: Metadata = { title: 'Float & cash' };

const referenceSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,32}$/);

type CashOutCheck =
  | { outcome: 'PAY'; detail: TransferDetail }
  | { outcome: 'REVERSED'; detail: TransferDetail }
  | { outcome: 'OWN' }
  | { outcome: 'UNKNOWN' };

/** Looks a cash-out reference up — only payments that actually reached this agent qualify. */
async function checkCashOut(
  ctx: Parameters<typeof getTransferDetail>[0],
  reference: string,
): Promise<CashOutCheck> {
  let detail: TransferDetail;
  try {
    detail = await getTransferDetail(ctx, reference);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return { outcome: 'UNKNOWN' };
    throw error;
  }
  if (detail.perspective !== 'RECIPIENT') return { outcome: 'OWN' };
  if (detail.transfer.status === 'COMPLETED') return { outcome: 'PAY', detail };
  if (detail.transfer.status === 'REVERSED') return { outcome: 'REVERSED', detail };
  return { outcome: 'UNKNOWN' };
}

/**
 * Agent desk: the float wallet, cash-in (float → customer wallet through the transfer engine)
 * and cash-out (the customer pays the agent code from their app; the agent verifies the payment
 * here before handing over cash).
 */
export default async function PartnerFloatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx, partner } = await getPartnerPage();
  if (partner.type !== 'AGENT') notFound();

  const raw = (await searchParams).ref;
  const typed = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  const parsed = typed === '' ? null : referenceSchema.safeParse(typed);
  const [wallets, commissions, recent, check] = await Promise.all([
    listMyWallets(ctx),
    getCommissionSummary(ctx),
    listMyTransfers(ctx, { pageSize: 10 }),
    parsed === null
      ? null
      : parsed.success
        ? checkCashOut(ctx, parsed.data)
        : ({ outcome: 'UNKNOWN' } as const),
  ]);
  const float = wallets.find((wallet) => wallet.currency === partner.currency);
  const commission = commissions.find((row) => row.currency === partner.currency);
  const ready = partner.status === 'ACTIVE' && float?.status === 'ACTIVE';

  return (
    <>
      <PageHeader
        title="Float & cash"
        description="Your float is the e-money you hold with BI-Rem. Cash-in moves it to a customer; cash-out brings it back when a customer pays your agent code."
      />

      <StatGrid className="lg:grid-cols-3">
        <Stat
          label="Float balance"
          value={float ? <Money amount={float.balance} currency={float.currency} /> : '—'}
          hint={float ? 'Available for cash-in' : 'Created when the account is approved'}
        />
        <Stat
          label="Your agent code"
          value={<span className="font-mono tracking-wider">{partner.code}</span>}
          hint="Customers send to this code to cash out"
        />
        <Stat
          label="Commission accrued"
          value={<Money amount={commission?.accrued ?? 0n} currency={partner.currency} />}
          hint={`${formatBps(partner.commissionBps)} per transaction, paid by settlement`}
        />
      </StatGrid>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Cash-in"
            description="A customer hands you cash; you credit their wallet from your float."
          />
          <CardBody>
            {ready ? null : (
              <Alert tone="info" className="mb-4">
                Cash-in is available once your agent account and float wallet are active.
              </Alert>
            )}
            <CashInFlow
              previewAction={previewCashInAction}
              confirmAction={confirmCashInAction}
              currency={partner.currency}
              disabled={!ready}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Cash-out"
            description="A customer sends e-money to your code; you hand over the cash."
          />
          <CardBody className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-muted">
              <li>
                The customer opens <strong className="text-fg">Send money</strong> in their BI-Rem
                app and sends the amount to your code.
              </li>
              <li>They show you the transfer reference (BR…).</li>
              <li>Check it below. Hand over cash only when it says the payment reached you.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-3">
              <code className="rounded-lg bg-accent-soft px-3 py-2 font-mono text-lg font-semibold tracking-wider text-accent">
                {partner.code}
              </code>
              <CopyButton value={partner.code} label="Copy code" />
            </div>

            <form
              method="get"
              action="/partner/float"
              className="space-y-3 border-t border-border pt-4"
            >
              <Input
                name="ref"
                label="Transfer reference"
                placeholder="BRK7Q2M9XD4T"
                defaultValue={typed}
                autoComplete="off"
                autoCapitalize="characters"
                required
                maxLength={32}
              />
              <button type="submit" className={buttonClasses('secondary', 'sm')}>
                Verify payment
              </button>
            </form>

            {check?.outcome === 'PAY' ? (
              <Alert tone="success" title="Payment received — you can pay out">
                <p data-testid="cash-out-result">
                  <Money
                    amount={check.detail.transfer.receiveAmount}
                    currency={check.detail.transfer.targetCurrency}
                    className="font-semibold"
                  />{' '}
                  from {check.detail.transfer.senderName}, received{' '}
                  {formatDateTime(check.detail.transfer.completedAt)}.
                </p>
                <p className="mt-1">
                  Pay each reference out once: note it on your cash sheet, and check the time above
                  is recent.
                </p>
              </Alert>
            ) : null}
            {check?.outcome === 'REVERSED' ? (
              <Alert tone="danger" title="Do not pay out — this payment was reversed">
                The amount was taken back from your float.
              </Alert>
            ) : null}
            {check?.outcome === 'OWN' ? (
              <Alert tone="warning" title="This is a transfer you sent, not a cash-out">
                Do not hand over cash for it.
              </Alert>
            ) : null}
            {check?.outcome === 'UNKNOWN' ? (
              <Alert tone="danger" title="No completed payment to you with this reference">
                Do not hand over cash. Ask the customer to check the reference in their app.
              </Alert>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Recent cash movements"
          description="Cash-ins you made and cash-outs you received"
          action={
            <LinkButton href="/partner/transactions" variant="secondary" size="sm">
              View all
            </LinkButton>
          }
        />
        {recent.items.length === 0 ? (
          <EmptyState title="No movement yet" />
        ) : (
          <TransactionsTable items={recent.items} caption="Recent cash movements" compact />
        )}
      </Card>
    </>
  );
}
