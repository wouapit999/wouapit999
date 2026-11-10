'use client';

import { useState } from 'react';

import { asSerialized } from '@/app/app/_lib/client';
import { confirmTopUpAction, reviewTopUpAction } from '@/app/app/wallets/actions';
import {
  ActionForm,
  Alert,
  Button,
  DescriptionList,
  FormActions,
  FormMessage,
  Input,
  Money,
  Select,
  SimulatedBadge,
  SubmitButton,
} from '@/components/ui';

export interface TopUpWalletOption {
  readonly id: string;
  readonly currency: string;
  /** Minor units as a string. */
  readonly balance: string;
}

export interface TopUpLinkedOption {
  readonly id: string;
  readonly providerName: string;
  readonly accountNumber: string;
  readonly currency: string;
}

export interface TopUpProviderOption {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly simulated: boolean;
}

const reviewAction = asSerialized(reviewTopUpAction);
/** What `reviewTopUpAction` returns, as it arrives in the browser (amounts are strings). */
type TopUpReview = NonNullable<Awaited<ReturnType<typeof reviewAction>>['data']>;

/**
 * Two-step cash-in: details → confirmation. The review step validates the paying account with
 * the operator's connector and mints the idempotency key of the submission; the confirm step
 * sends exactly what was reviewed. Nothing is collected before "Confirm top-up".
 */
export function TopUpFlow({
  wallets,
  linked,
  providers,
  initialWalletId,
  initialSource,
}: {
  wallets: readonly TopUpWalletOption[];
  linked: readonly TopUpLinkedOption[];
  providers: readonly TopUpProviderOption[];
  initialWalletId?: string;
  initialSource?: string;
}) {
  const firstWallet = wallets.find((wallet) => wallet.id === initialWalletId) ?? wallets[0];
  const [walletId, setWalletId] = useState(firstWallet?.id ?? '');
  const wallet = wallets.find((candidate) => candidate.id === walletId) ?? firstWallet;
  const currency = wallet?.currency ?? '';

  const linkedHere = linked.filter((account) => account.currency === currency);
  const providersHere = providers.filter((provider) => provider.currency === currency);
  const defaultSource =
    linkedHere.find((account) => account.id === initialSource)?.id ?? linkedHere[0]?.id ?? 'OTHER';
  const [chosenSource, setChosenSource] = useState<string | null>(null);
  // A source chosen for another currency is no longer offered after switching wallets.
  const source =
    chosenSource !== null &&
    (chosenSource === 'OTHER' || linkedHere.some((account) => account.id === chosenSource))
      ? chosenSource
      : defaultSource;

  const [review, setReview] = useState<TopUpReview | null>(null);

  if (!wallet) return null;

  return (
    <div>
      <div hidden={review !== null}>
        <ActionForm<TopUpReview>
          action={reviewAction}
          className="space-y-4"
          onResult={(state) => {
            if (state.ok && state.data) setReview(state.data);
          }}
        >
          <Select
            name="walletId"
            label="Wallet to top up"
            required
            value={walletId}
            onChange={(event) => setWalletId(event.target.value)}
            options={wallets.map((option) => ({
              value: option.id,
              label: `${option.currency} wallet`,
            }))}
            hint={
              <>
                Current balance: <Money amount={wallet.balance} currency={wallet.currency} />
              </>
            }
          />
          <Select
            name="source"
            label="Pay from"
            required
            value={source}
            onChange={(event) => setChosenSource(event.target.value)}
            options={[
              ...linkedHere.map((account) => ({
                value: account.id,
                label: `${account.providerName} · ${account.accountNumber} (linked)`,
              })),
              { value: 'OTHER', label: 'Another mobile-money number…' },
            ]}
          />
          {source === 'OTHER' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                name="providerId"
                label="Mobile-money provider"
                required
                placeholder={
                  providersHere.length > 0 ? 'Choose a provider' : `No ${currency} provider`
                }
                options={providersHere.map((provider) => ({
                  value: provider.id,
                  label: provider.simulated ? `${provider.name} (simulated)` : provider.name,
                }))}
              />
              <Input
                name="accountNumber"
                label="Mobile-money number"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+237 6 77 00 01 23"
                required
              />
            </div>
          ) : null}
          <Input
            name="amount"
            label={`Amount (${currency})`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            required
          />
          <FormMessage showSuccess={false} />
          <FormActions>
            <SubmitButton pendingLabel="Checking the account…">Review top-up</SubmitButton>
          </FormActions>
        </ActionForm>
      </div>

      {review ? (
        <ActionForm action={confirmTopUpAction} className="space-y-4">
          <h3 className="text-base font-semibold text-fg">Check and confirm</h3>
          <input type="hidden" name="walletId" value={review.walletId} />
          <input type="hidden" name="providerId" value={review.providerId} />
          <input type="hidden" name="accountNumber" value={review.accountNumber} />
          <input type="hidden" name="amountMinor" value={review.amount} />
          <input type="hidden" name="idempotencyKey" value={review.idempotencyKey} />
          <DescriptionList
            items={[
              { label: 'Wallet', value: `${review.currency} wallet` },
              {
                label: 'Pay from',
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    {review.providerName} · {review.accountNumber}
                    {review.simulated ? <SimulatedBadge /> : null}
                  </span>
                ),
              },
              {
                label: 'Account holder',
                value: review.accountName ?? 'Not provided by the operator',
              },
              {
                label: 'Collected from the account',
                value: <Money amount={review.amount} currency={review.currency} />,
              },
              {
                label: 'Fee',
                value: <Money amount={review.feeAmount} currency={review.currency} />,
              },
              {
                label: 'Credited to your wallet',
                value: (
                  <Money
                    amount={review.creditAmount}
                    currency={review.currency}
                    className="font-semibold"
                  />
                ),
              },
            ]}
          />
          {review.simulated ? (
            <Alert tone="info" title="Simulated cash-in">
              {review.providerName} runs on the sandbox simulator: no real mobile-money account is
              debited. Your BI-Rem wallet is credited for demonstration purposes only.
            </Alert>
          ) : null}
          <FormMessage />
          <FormActions>
            <SubmitButton pendingLabel="Requesting the collection…">Confirm top-up</SubmitButton>
            <Button variant="secondary" onClick={() => setReview(null)}>
              Edit
            </Button>
          </FormActions>
        </ActionForm>
      ) : null}
    </div>
  );
}
