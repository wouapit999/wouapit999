import type { Metadata } from 'next';

import { LimitsSummary } from '@/components/customer/limits-card';
import { SendFlow } from '@/components/customer/send-flow';
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
} from '@/components/ui';
import { getPageContext } from '@/server/auth/session';
import { listBeneficiaries } from '@/server/beneficiaries';
import { listAvailableProviders } from '@/server/connectors';
import { listCountries } from '@/server/countries';
import { getLimitOverview } from '@/server/kyc';
import { isLinkedAccount } from '@/server/linked-accounts';
import { serialize } from '@/server/money';
import { SOURCES_OF_FUNDS, TRANSFER_PURPOSES } from '@/server/transfers';
import { listMyWallets } from '@/server/wallets';

import { type SearchParams, readSearchParams } from '../_lib/page';

export const metadata: Metadata = { title: 'Send money' };

/** Guided transfer: domestic (wallet, merchant, agent, mobile money) or international. */
export default async function SendPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, user } = await getPageContext('CUSTOMER');
  const query = await readSearchParams(searchParams);
  const [wallets, countries, providers, beneficiaries, limits] = await Promise.all([
    listMyWallets(ctx),
    listCountries({ enabled: true }),
    listAvailableProviders(),
    listBeneficiaries(ctx),
    getLimitOverview(ctx),
  ]);
  const activeWallets = wallets.filter((wallet) => wallet.status === 'ACTIVE');
  const home = countries.find((country) => country.code === user.countryCode);

  return (
    <>
      <PageHeader
        title="Send money"
        description="To a BI-Rem wallet, a merchant, an agent or a mobile-money number — at home or abroad."
      />

      {!home || activeWallets.length === 0 ? (
        <Card>
          <EmptyState
            title={home ? 'No active wallet' : 'Transfers are not available for your country yet'}
            description={
              home
                ? 'You need an active wallet with money in it before you can send.'
                : 'Your country of residence is not enabled for transfers at the moment.'
            }
            action={
              <LinkButton href="/app/wallets" variant="secondary">
                Go to wallets
              </LinkButton>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
          <Card className="lg:col-span-2">
            <CardBody>
              <SendFlow
                wallets={serialize(
                  activeWallets.map((wallet) => ({
                    id: wallet.id,
                    currency: wallet.currency,
                    balance: wallet.balance,
                  })),
                )}
                home={{ code: home.code, name: home.name, currency: home.currency }}
                corridors={countries
                  .filter((country) => country.code !== home.code)
                  .map((country) => ({
                    code: country.code,
                    name: country.name,
                    currency: country.currency,
                  }))
                  .sort((a, b) => a.name.localeCompare(b.name))}
                providers={providers
                  .filter((provider) => provider.supportsPayout)
                  .map((provider) => ({
                    id: provider.id,
                    name: provider.name,
                    countryCode: provider.countryCode,
                    simulated: provider.simulated,
                  }))}
                beneficiaries={beneficiaries.map((beneficiary) => ({
                  id: beneficiary.id,
                  label: isLinkedAccount(beneficiary)
                    ? `My ${beneficiary.provider?.name ?? 'mobile money'} · ${beneficiary.accountNumber} (cash out)`
                    : `${beneficiary.nickname ?? beneficiary.fullName} · ${
                        beneficiary.method === 'WALLET'
                          ? 'BI-Rem'
                          : (beneficiary.provider?.name ?? 'Mobile money')
                      } · ${beneficiary.accountNumber}`,
                  countryCode: beneficiary.countryCode,
                }))}
                purposes={TRANSFER_PURPOSES}
                sourcesOfFunds={SOURCES_OF_FUNDS}
                internationalAllowed={limits.limits.international}
                initialBeneficiaryId={query.beneficiary}
                initialWalletId={query.wallet}
              />
            </CardBody>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Your limits" />
              <CardBody>
                <LimitsSummary
                  tier={limits.tier}
                  international={limits.limits.international}
                  currency={limits.currency}
                  local={limits.local}
                />
              </CardBody>
            </Card>
            <Alert tone="info" title="Try it in the sandbox">
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  Merchant <span className="font-mono">M-DEMO01</span>, agent{' '}
                  <span className="font-mono">A-DEMO01</span>
                </li>
                <li>
                  Abroad: <span className="font-mono">joao@example.com</span> (Angola)
                </li>
                <li>
                  Mobile-money numbers are simulated: ending <span className="font-mono">0001</span>{' '}
                  fails, <span className="font-mono">0003</span> stays pending until you check the
                  status
                </li>
                <li>Large amounts (about US$3,000 and more) are held for a compliance review</li>
              </ul>
            </Alert>
          </div>
        </div>
      )}
    </>
  );
}
