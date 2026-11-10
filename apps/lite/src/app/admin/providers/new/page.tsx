import type { Metadata } from 'next';

import { ProviderFields } from '@/components/admin/provider-form';
import {
  ActionForm,
  Alert,
  Card,
  CardBody,
  CardHeader,
  FormActions,
  FormMessage,
  LinkButton,
  PageHeader,
  SubmitButton,
} from '@/components/ui';
import { requirePermission } from '@/server/auth/session';
import { ADAPTER_OPTIONS } from '@/server/connectors';
import { listCountries } from '@/server/countries';
import { CURRENCY_CODES } from '@/server/money';

import { createProviderAction } from '../actions';

export const metadata: Metadata = { title: 'Add provider' };

/** Add a provider: one database row. Secrets are entered on the next screen. */
export default async function NewProviderPage() {
  await requirePermission('providers:write');
  const countries = await listCountries();
  return (
    <>
      <PageHeader
        back={{ href: '/admin/providers', label: 'Providers' }}
        title="Add provider"
        description="Describe the connection. After saving you can store its credentials and webhook secret, then test connectivity."
      />
      <Card>
        <CardHeader title="Connection settings" />
        <CardBody>
          <ActionForm action={createProviderAction} className="space-y-5">
            <ProviderFields
              countries={countries}
              adapters={ADAPTER_OPTIONS}
              currencies={CURRENCY_CODES}
            />
            <Alert tone="info">
              The generic HTTP adapter is config-driven and has not been exercised against a real
              operator yet. Keep new production providers disabled until a connectivity test and a
              small live payout have succeeded.
            </Alert>
            <FormMessage />
            <FormActions>
              <SubmitButton pendingLabel="Creating…">Create provider</SubmitButton>
              <LinkButton href="/admin/providers" variant="ghost">
                Cancel
              </LinkButton>
            </FormActions>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
