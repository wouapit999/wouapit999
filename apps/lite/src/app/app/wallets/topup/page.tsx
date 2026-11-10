import type { Metadata } from 'next';

import { TopUpFlow } from '@/components/customer/topup-flow';
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  SimulatedBadge,
} from '@/components/ui';
import { getPageContext } from '@/server/auth/session';
import { SIMULATOR_SCENARIOS, listAvailableProviders } from '@/server/connectors';
import { listLinkedAccounts } from '@/server/linked-accounts';
import { serialize } from '@/server/money';
import { listMyWallets } from '@/server/wallets';

import { type SearchParams, readSearchParams } from '../../_lib/page';

export const metadata: Metadata = { title: 'Top up' };

/** Cash-in from a mobile-money account into a BI-Rem wallet (sandbox: the operator is simulated). */
export default async function TopUpPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await getPageContext('CUSTOMER');
  const query = await readSearchParams(searchParams);
  const [wallets, linked, providers] = await Promise.all([
    listMyWallets(ctx),
    listLinkedAccounts(ctx),
    listAvailableProviders(),
  ]);
  const activeWallets = wallets.filter((wallet) => wallet.status === 'ACTIVE');
  const currencies = new Set(activeWallets.map((wallet) => wallet.currency));
  const collectors = providers.filter(
    (provider) => provider.supportsCollection && currencies.has(provider.currency),
  );
  const usableLinked = linked.filter(
    (account) => account.providerActive && account.supportsCollection,
  );

  return (
    <>
      <PageHeader
        back={{ href: '/app/wallets', label: 'Wallets' }}
        title="Top up your wallet"
        description="Move money from a mobile-money account into your BI-Rem wallet."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Cash-in from mobile money"
            description="Two steps: we check the account with the operator, then you confirm."
            action={<SimulatedBadge />}
          />
          <CardBody>
            {activeWallets.length === 0 ? (
              <EmptyState
                title="No active wallet"
                description="You need an active wallet before you can top it up."
                action={
                  <LinkButton href="/app/wallets" variant="secondary">
                    Back to wallets
                  </LinkButton>
                }
              />
            ) : (
              <TopUpFlow
                wallets={serialize(
                  activeWallets.map((wallet) => ({
                    id: wallet.id,
                    currency: wallet.currency,
                    balance: wallet.balance,
                  })),
                )}
                linked={usableLinked.map((account) => ({
                  id: account.id,
                  providerName: account.providerName,
                  accountNumber: account.accountNumber,
                  currency: account.currency,
                }))}
                providers={collectors.map((provider) => ({
                  id: provider.id,
                  name: provider.name,
                  currency: provider.currency,
                  simulated: provider.simulated,
                }))}
                initialWalletId={query.wallet}
                initialSource={query.source}
              />
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Alert tone="warning" title="This is a simulated cash-in">
            No real mobile-money account is debited. The operator&apos;s answer comes from the
            sandbox simulator and your wallet is credited for demonstration purposes only.
          </Alert>
          <Card>
            <CardHeader title="Sandbox test numbers" description="The last four digits decide." />
            <CardBody>
              <ul className="space-y-1.5 text-sm">
                {SIMULATOR_SCENARIOS.map((scenario) => (
                  <li key={scenario.suffix} className="flex gap-2">
                    <span className="tabular shrink-0 font-mono font-semibold">
                      …{scenario.suffix}
                    </span>
                    <span className="text-fg-muted">{scenario.label}</span>
                  </li>
                ))}
                <li className="flex gap-2">
                  <span className="shrink-0 font-semibold">Other</span>
                  <span className="text-fg-muted">Succeeds immediately</span>
                </li>
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
