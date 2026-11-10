import type { Metadata } from 'next';

import {
  ActionForm,
  Alert,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ConfirmSubmitButton,
  EmptyState,
  FormActions,
  FormMessage,
  Input,
  LinkButton,
  Money,
  PageHeader,
  Select,
  SimulatedBadge,
  StatusBadge,
  SubmitButton,
} from '@/components/ui';
import { formatDate } from '@/lib/format';
import { getPageContext } from '@/server/auth/session';
import { SIMULATOR_SCENARIOS, listAvailableProviders } from '@/server/connectors';
import { getCountry } from '@/server/countries';
import { listLinkedAccounts } from '@/server/linked-accounts';
import { listMyWallets } from '@/server/wallets';

import { linkAccountAction, refreshBalancesAction, unlinkAccountAction } from './actions';

export const metadata: Metadata = { title: 'Wallets' };

/** BI-Rem wallets (ledger balances) and the customer's linked mobile-money accounts. */
export default async function WalletsPage() {
  const { ctx, user } = await getPageContext('CUSTOMER');
  const [wallets, linked, country, providers] = await Promise.all([
    listMyWallets(ctx),
    listLinkedAccounts(ctx),
    user.countryCode ? getCountry(user.countryCode) : null,
    user.countryCode ? listAvailableProviders({ countryCode: user.countryCode }) : [],
  ]);

  return (
    <>
      <PageHeader
        title="Wallets"
        description="Your BI-Rem balances and the mobile-money accounts you use to cash in and out."
        actions={
          <>
            <LinkButton href="/app/wallets/topup">Top up</LinkButton>
            <LinkButton href="/app/send" variant="secondary">
              Send money
            </LinkButton>
          </>
        }
      />

      <div className="space-y-4 lg:space-y-6">
        <Card>
          <CardHeader
            title="BI-Rem wallets"
            description="One wallet per currency. Balances are read from the double-entry ledger."
          />
          <CardBody>
            {wallets.length === 0 ? (
              <EmptyState
                title="No wallet yet"
                description="A wallet is created when you register with a supported country."
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {wallets.map((wallet) => (
                  <li key={wallet.id} className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                        {wallet.currency} wallet
                      </p>
                      <StatusBadge status={wallet.status} />
                    </div>
                    <p className="mt-1 text-2xl font-semibold">
                      <Money amount={wallet.balance} currency={wallet.currency} />
                    </p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      Opened {formatDate(wallet.createdAt)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <LinkButton href={`/app/wallets/${wallet.id}`} variant="secondary" size="sm">
                        Statement
                      </LinkButton>
                      {wallet.status === 'ACTIVE' ? (
                        <LinkButton
                          href={`/app/wallets/topup?wallet=${wallet.id}`}
                          variant="secondary"
                          size="sm"
                        >
                          Top up
                        </LinkButton>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
          <CardFooter>
            <ActionForm
              action={refreshBalancesAction}
              className="flex flex-wrap items-center gap-3"
            >
              <SubmitButton variant="secondary" size="sm" pendingLabel="Refreshing…">
                Refresh balances
              </SubmitButton>
              <FormMessage className="py-1.5" />
            </ActionForm>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader
            title="Linked mobile-money accounts"
            description="Your own operator accounts, checked with the operator before they are saved."
            action={<SimulatedBadge />}
          />
          {linked.length === 0 ? (
            <EmptyState
              title="No linked account"
              description="Link the mobile-money number you own to top up and cash out in two taps."
            />
          ) : (
            <ul aria-label="Linked mobile-money accounts" className="divide-y divide-border">
              {linked.map((account) => (
                <li
                  key={account.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                      {account.providerName}
                      {account.simulated ? <SimulatedBadge /> : null}
                      {account.providerActive ? null : (
                        <StatusBadge status="INACTIVE" label="Provider unavailable" />
                      )}
                    </p>
                    <p className="tabular mt-0.5 text-sm text-fg">{account.accountNumber}</p>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      Holder (from the operator): {account.accountName}
                      {account.nickname ? ` · “${account.nickname}”` : ''} · {account.currency} ·
                      linked {formatDate(account.linkedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {account.providerActive && account.supportsCollection ? (
                      <LinkButton
                        href={`/app/wallets/topup?source=${account.id}`}
                        variant="secondary"
                        size="sm"
                      >
                        Top up from it
                      </LinkButton>
                    ) : null}
                    {account.providerActive && account.supportsPayout ? (
                      <LinkButton
                        href={`/app/send?beneficiary=${account.id}`}
                        variant="secondary"
                        size="sm"
                      >
                        Cash out to it
                      </LinkButton>
                    ) : null}
                    <ActionForm action={unlinkAccountAction}>
                      <input type="hidden" name="id" value={account.id} />
                      <ConfirmSubmitButton
                        variant="ghost"
                        size="sm"
                        confirm={`Unlink ${account.providerName} ${account.accountNumber}?`}
                        pendingLabel="Unlinking…"
                      >
                        Unlink
                      </ConfirmSubmitButton>
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <CardBody className="border-t border-border">
            <h3 className="text-sm font-semibold text-fg">Link an account</h3>
            {providers.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">
                No mobile-money operator is connected in {country?.name ?? 'your country'} yet. You
                can still receive money in your BI-Rem wallet.
              </p>
            ) : (
              <ActionForm action={linkAccountAction} className="mt-3 space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Select
                    name="providerId"
                    label="Provider"
                    required
                    placeholder="Choose a provider"
                    options={providers.map((provider) => ({
                      value: provider.id,
                      label: provider.simulated ? `${provider.name} (simulated)` : provider.name,
                    }))}
                    hint={country ? `Operators in ${country.name}` : undefined}
                  />
                  <Input
                    name="accountNumber"
                    label="Mobile-money number"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder={country ? `${country.dialCode} …` : '+…'}
                    required
                  />
                  <Input name="nickname" label="Nickname" maxLength={60} placeholder="My MoMo" />
                </div>
                <FormMessage />
                <FormActions>
                  <SubmitButton pendingLabel="Checking with the operator…">
                    Validate and link
                  </SubmitButton>
                </FormActions>
              </ActionForm>
            )}
            <p className="mt-4 text-xs text-fg-subtle">
              BI-Rem only checks that the account exists. It cannot see the balance you hold with
              the operator, so none is shown here.
            </p>
          </CardBody>
        </Card>

        <Alert tone="info" title="Sandbox operators">
          <p>
            Every mobile-money operator in BI-Rem Lite is a deterministic simulator — no real
            account is ever contacted. The last four digits of a number decide the outcome:
          </p>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {SIMULATOR_SCENARIOS.map((scenario) => (
              <li key={scenario.suffix}>
                <span className="tabular font-mono font-semibold">…{scenario.suffix}</span> —{' '}
                {scenario.label}
              </li>
            ))}
            <li>Any other number — succeeds immediately</li>
          </ul>
        </Alert>
      </div>
    </>
  );
}
