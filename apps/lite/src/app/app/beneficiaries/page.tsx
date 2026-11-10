import type { Metadata } from 'next';

import { BeneficiaryForm } from '@/components/customer/beneficiary-form';
import {
  ActionForm,
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ConfirmSubmitButton,
  EmptyState,
  LinkButton,
  PageHeader,
  SimulatedBadge,
} from '@/components/ui';
import { getPageContext } from '@/server/auth/session';
import { listBeneficiaries } from '@/server/beneficiaries';
import { listAvailableProviders } from '@/server/connectors';
import { listCountries } from '@/server/countries';
import { isLinkedAccount } from '@/server/linked-accounts';

import { type SearchParams, readSearchParams } from '../_lib/page';
import { archiveBeneficiaryAction } from './actions';

export const metadata: Metadata = { title: 'Beneficiaries' };

/** The customer's saved recipients: list, add (with account validation), edit, remove. */
export default async function BeneficiariesPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await getPageContext('CUSTOMER');
  const query = await readSearchParams(searchParams);
  const [all, providers, countries] = await Promise.all([
    listBeneficiaries(ctx),
    listAvailableProviders(),
    listCountries({ enabled: true }),
  ]);
  // The customer's own linked mobile-money accounts are managed under Wallets.
  const beneficiaries = all.filter((beneficiary) => !isLinkedAccount(beneficiary));
  const countryName = new Map(countries.map((country) => [country.code, country.name]));

  return (
    <>
      <PageHeader
        title="Beneficiaries"
        description="People and businesses you pay often. Each account is checked before it is saved."
      />

      {query.updated ? (
        <Alert tone="success" className="mb-4">
          Beneficiary updated.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Saved beneficiaries"
            description={
              beneficiaries.length === 1 ? '1 beneficiary' : `${beneficiaries.length} beneficiaries`
            }
          />
          {beneficiaries.length === 0 ? (
            <EmptyState
              title="No beneficiary yet"
              description="Add someone once, then send them money in a couple of taps."
            />
          ) : (
            <ul aria-label="Saved beneficiaries" className="divide-y divide-border">
              {beneficiaries.map((beneficiary) => {
                const simulated = beneficiary.provider?.adapter === 'simulator';
                return (
                  <li key={beneficiary.id} className="px-5 py-4 sm:px-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-fg">
                          {beneficiary.fullName}
                          {beneficiary.nickname ? (
                            <span className="font-normal text-fg-muted">
                              {' '}
                              · “{beneficiary.nickname}”
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 break-all text-sm text-fg">
                          {beneficiary.accountNumber}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                          <Badge tone={beneficiary.method === 'WALLET' ? 'brand' : 'neutral'}>
                            {beneficiary.method === 'WALLET'
                              ? 'BI-Rem account'
                              : (beneficiary.provider?.name ?? 'Mobile money')}
                          </Badge>
                          {simulated ? <SimulatedBadge /> : null}
                          <span>
                            {beneficiary.country.name} · {beneficiary.currency}
                            {beneficiary.relationship ? ` · ${beneficiary.relationship}` : ''}
                          </span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <LinkButton href={`/app/send?beneficiary=${beneficiary.id}`} size="sm">
                          Send
                        </LinkButton>
                        <LinkButton
                          href={`/app/beneficiaries/${beneficiary.id}`}
                          variant="secondary"
                          size="sm"
                        >
                          Edit
                        </LinkButton>
                        <ActionForm action={archiveBeneficiaryAction}>
                          <input type="hidden" name="id" value={beneficiary.id} />
                          <ConfirmSubmitButton
                            variant="ghost"
                            size="sm"
                            confirm={`Remove ${beneficiary.fullName} from your beneficiaries?`}
                            pendingLabel="Removing…"
                            aria-label={`Remove ${beneficiary.fullName}`}
                          >
                            Remove
                          </ConfirmSubmitButton>
                        </ActionForm>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Add a beneficiary" />
          <CardBody>
            <BeneficiaryForm
              providers={providers
                .filter((provider) => provider.supportsPayout)
                .map((provider) => ({
                  id: provider.id,
                  name: provider.name,
                  countryName: countryName.get(provider.countryCode) ?? provider.countryCode,
                  currency: provider.currency,
                  simulated: provider.simulated,
                }))}
            />
            <p className="mt-4 text-xs text-fg-subtle">
              Mobile-money numbers are validated by the sandbox simulator, not a real operator. A
              number ending in 0000 is reported as non-existent.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
