import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import {
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Money,
  PageHeader,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { getWallet, getWalletStatement } from '@/server/wallets';

import { JOURNAL_KIND_LABELS, labelFor } from '../../_lib/labels';
import { type SearchParams, orNotFound, readSearchParams, uuidParam } from '../../_lib/page';

export const metadata: Metadata = { title: 'Wallet statement' };

const PAGE_SIZE = 25;

const querySchema = z.object({
  /** Cursor: show entries strictly older than this instant. */
  before: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .optional()
    .catch(undefined),
});

/** Statement of one of the customer's wallets: every ledger entry, newest first. */
export default async function WalletStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { ctx } = await getPageContext('CUSTOMER');
  const walletId = uuidParam((await params).id);
  const { before } = querySchema.parse(await readSearchParams(searchParams));

  // Customers only ever get their own wallets from the service; anything else is a 404.
  const wallet = await orNotFound(() => getWallet(ctx, walletId));
  const lines = await getWalletStatement(ctx, wallet.id, { limit: PAGE_SIZE + 1, before });
  const visible = lines.slice(0, PAGE_SIZE);
  const last = visible[visible.length - 1];
  const hasMore = lines.length > PAGE_SIZE && last !== undefined;

  return (
    <>
      <PageHeader
        back={{ href: '/app/wallets', label: 'Wallets' }}
        title={`${wallet.currency} wallet statement`}
        description="Every movement on this wallet, straight from the ledger. Entries are never edited or deleted — corrections appear as new lines."
        actions={
          wallet.status === 'ACTIVE' ? (
            <LinkButton href={`/app/wallets/topup?wallet=${wallet.id}`} variant="secondary">
              Top up
            </LinkButton>
          ) : null
        }
      />

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Current balance
          </p>
          <p className="mt-1 text-3xl font-semibold">
            <Money amount={wallet.balance} currency={wallet.currency} />
          </p>
        </div>
        <StatusBadge status={wallet.status} />
      </Card>

      <Card>
        <CardHeader
          title="Movements"
          description={before ? `Entries before ${formatDateTime(before)}` : 'Most recent first'}
          action={
            before ? (
              <LinkButton href={`/app/wallets/${wallet.id}`} variant="ghost" size="sm">
                Back to latest
              </LinkButton>
            ) : null
          }
        />
        {visible.length === 0 ? (
          <EmptyState
            title={before ? 'No older movements' : 'No movements yet'}
            description={
              before
                ? 'You have reached the beginning of this statement.'
                : 'Top up this wallet or receive a transfer to see it here.'
            }
          />
        ) : (
          <>
            <Table caption={`Statement of the ${wallet.currency} wallet`}>
              <THead>
                <Tr>
                  <Th>Date</Th>
                  <Th>Description</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance after</Th>
                </Tr>
              </THead>
              <TBody>
                {visible.map((line) => (
                  <Tr key={line.entryId}>
                    <Td className="whitespace-nowrap text-fg-muted">
                      {formatDateTime(line.createdAt)}
                    </Td>
                    <Td>
                      <span className="block font-medium text-fg">
                        {labelFor(JOURNAL_KIND_LABELS, line.kind)}
                      </span>
                      {line.transferId ? (
                        <Link
                          href={`/app/transfers/${line.transferId}`}
                          className="text-xs text-accent hover:underline"
                        >
                          {line.description}
                        </Link>
                      ) : (
                        <span className="text-xs text-fg-muted">{line.description}</span>
                      )}
                    </Td>
                    <Td align="right">
                      <Money amount={line.delta} currency={line.currency} signed withCode={false} />
                    </Td>
                    <Td align="right">
                      <Money amount={line.balanceAfter} currency={line.currency} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {hasMore ? (
              <div className="flex justify-end border-t border-border px-4 py-3">
                <LinkButton
                  href={`/app/wallets/${wallet.id}?before=${encodeURIComponent(last.createdAt.toISOString())}`}
                  variant="secondary"
                  size="sm"
                >
                  Older movements
                </LinkButton>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
