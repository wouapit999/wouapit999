import type { Metadata } from 'next';

import {
  ActionForm,
  Card,
  CardBody,
  CardHeader,
  FormActions,
  FormMessage,
  Input,
  LinkButton,
  PageHeader,
  Select,
  SubmitButton,
  Textarea,
} from '@/components/ui';
import { requirePermission } from '@/server/auth/session';
import { listCountries } from '@/server/countries';

import { createPartnerAction } from '../actions';

export const metadata: Metadata = { title: 'Onboard partner' };

/** Onboard a partner, merchant or agent directly (no application step). */
export default async function NewPartnerPage() {
  await requirePermission('partners:write');
  const countries = await listCountries({ enabled: true });
  return (
    <>
      <PageHeader
        back={{ href: '/admin/partners', label: 'Partners' }}
        title="Onboard a partner"
        description="Creates the partner as active with a wallet in the country's currency. Optionally create the partner's own login."
      />
      <Card>
        <CardHeader title="Business" />
        <CardBody>
          <ActionForm action={createPartnerAction} className="space-y-5" autoComplete="off">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                name="type"
                label="Type"
                required
                placeholder="Choose a type"
                options={[
                  { value: 'MERCHANT', label: 'Merchant — accepts payments' },
                  { value: 'AGENT', label: 'Agent — cash-in / cash-out' },
                  { value: 'PARTNER', label: 'Partner — API integration' },
                ]}
              />
              <Select
                name="countryCode"
                label="Country"
                required
                placeholder="Choose a country"
                options={countries.map((country) => ({
                  value: country.code,
                  label: `${country.name} (${country.currency})`,
                }))}
              />
              <Input name="name" label="Business name" required minLength={2} maxLength={120} />
              <Input name="legalName" label="Legal name" maxLength={160} />
              <Input name="contactEmail" type="email" label="Contact e-mail" required />
              <Input name="contactPhone" type="tel" label="Contact phone" placeholder="+237…" />
              <Input name="website" type="url" label="Website" placeholder="https://…" />
              <Input
                name="commissionBps"
                type="number"
                label="Commission (basis points)"
                hint="30 bps = 0.30% of each transfer, accrued for the partner."
                min={0}
                max={1000}
                defaultValue={0}
              />
              <Textarea
                name="description"
                label="Description"
                rows={2}
                maxLength={1000}
                containerClassName="sm:col-span-2"
              />
            </div>
            <fieldset className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium text-fg">Partner login (optional)</legend>
              <Input
                name="ownerName"
                label="User's full name"
                hint="Signs in with the contact e-mail."
                maxLength={120}
              />
              <Input
                name="ownerPassword"
                type="password"
                label="Initial password"
                hint="Share it out of band; the user should change it at first sign-in."
                autoComplete="new-password"
              />
            </fieldset>
            <FormMessage />
            <FormActions>
              <SubmitButton pendingLabel="Creating…">Create partner</SubmitButton>
              <LinkButton href="/admin/partners" variant="ghost">
                Cancel
              </LinkButton>
            </FormActions>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
