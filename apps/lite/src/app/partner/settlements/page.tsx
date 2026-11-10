import type { Metadata } from 'next';

import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  Money,
  PageHeader,
  Stat,
  StatGrid,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCommissionSummary, listSettlements } from '@/server/partners';
import { getWalletStatement, listMyWallets } from '@/server/wallets';

import { getPartnerPage } from '../_lib/partner';

export const metadata: Metadata = { title: 'Settlements' };

/** Settlement balance, commission payouts and the wallet statement behind the balance. */
export default async function PartnerSettlementsPage() {
  const { ctx, partner } = await getPartnerPage();
  const [wallets, settlements, summary] = await Promise.all([
    listMyWallets(ctx),
    listSettlements(ctx, { limit: 100 }),
    getCommissionSummary(ctx),
  ]);
  const home = wallets.find((wallet) => wallet.currency === partner.currency) ?? wallets[0];
  const statement = home ? await getWalletStatement(ctx, home.id, { limit: 25 }) : [];
  const accrued = summary.find((row) => row.currency === partner.currency);
  const paidTotal = settlements
    .filter((row) => row.currency === partner.currency && row.status === 'PAID')
    .reduce((total, row) => total + row.amount, 0n);

  return (
    <>
      <PageHeader
        title="Settlements"
        description="Your wallet is your settlement account: payments land in it immediately and accrued commission is paid into it when BI-Rem treasury runs a settlement."
      />

      {wallets.length === 0 ? (
        <Alert tone="info" title="No wallet yet" className="mb-4">
          Your settlement wallet is created when the partner account is approved.
        </Alert>
      ) : null}

      <StatGrid className="lg:grid-cols-3">
        {wallets.map((wallet) => (
          <Stat
            key={wallet.id}
            label={`Settlement balance · ${wallet.currency}`}
            value={<Money amount={wallet.balance} currency={wallet.currency} />}
            hint={
              wallet.status === 'ACTIVE' ? 'Available now' : `Wallet ${wallet.status.toLowerCase()}`
            }
            tone={wallet.status === 'ACTIVE' ? 'default' : 'warning'}
          />
        ))}
        <Stat
          label="Commission awaiting settlement"
          value={<Money amount={accrued?.accrued ?? 0n} currency={partner.currency} />}
          hint={`${accrued?.accruedCount ?? 0} transaction${accrued?.accruedCount === 1 ? '' : 's'}`}
        />
        <Stat
          label="Commission paid to date"
          value={<Money amount={paidTotal} currency={partner.currency} />}
          hint={`${settlements.length} settlement${settlements.length === 1 ? '' : 's'}`}
        />
      </StatGrid>

      <Card className="mt-5">
        <CardHeader
          title="Commission settlements"
          description="Each settlement is one balanced journal: commission payable → your wallet."
        />
        {settlements.length === 0 ? (
          <EmptyState
            title="No settlement yet"
            description="Accrued commission is paid here by BI-Rem treasury. You are notified in the portal and by the settlement.paid webhook."
          />
        ) : (
          <Table caption="Commission settlements">
            <THead>
              <Tr>
                <Th>Reference</Th>
                <Th>Period</Th>
                <Th align="right">Transactions</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th>Paid</Th>
              </Tr>
            </THead>
            <TBody>
              {settlements.map((settlement) => (
                <Tr key={settlement.id}>
                  <Td className="font-mono text-[0.8125rem]">{settlement.reference}</Td>
                  <Td className="whitespace-nowrap text-fg-muted">
                    {formatDate(settlement.periodStart)} – {formatDate(settlement.periodEnd)}
                  </Td>
                  <Td align="right">{settlement.commissionCount}</Td>
                  <Td align="right">
                    <Money
                      amount={settlement.amount}
                      currency={settlement.currency}
                      className="font-medium"
                    />
                  </Td>
                  <Td>
                    <StatusBadge status={settlement.status} />
                  </Td>
                  <Td className="whitespace-nowrap text-fg-muted">
                    {formatDateTime(settlement.paidAt)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {home ? (
        <Card className="mt-5">
          <CardHeader
            title={`Wallet statement · ${home.currency}`}
            description="The last 25 ledger entries of your wallet, newest first"
          />
          {statement.length === 0 ? (
            <EmptyState title="No movement yet" />
          ) : (
            <Table caption={`Wallet statement in ${home.currency}`}>
              <THead>
                <Tr>
                  <Th>Date</Th>
                  <Th>Description</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance after</Th>
                </Tr>
              </THead>
              <TBody>
                {statement.map((line) => (
                  <Tr key={line.entryId}>
                    <Td className="whitespace-nowrap text-fg-muted">
                      {formatDateTime(line.createdAt)}
                    </Td>
                    <Td>{line.description}</Td>
                    <Td align="right">
                      <Money amount={line.delta} currency={line.currency} signed />
                    </Td>
                    <Td align="right">
                      <Money amount={line.balanceAfter} currency={line.currency} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : null}
    </>
  );
}
