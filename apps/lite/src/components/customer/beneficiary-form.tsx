'use client';

import { useState } from 'react';

import { addBeneficiaryAction } from '@/app/app/beneficiaries/actions';
import { ActionForm, FormActions, FormMessage, Input, Select, SubmitButton } from '@/components/ui';

export interface BeneficiaryProviderOption {
  readonly id: string;
  readonly name: string;
  readonly countryName: string;
  readonly currency: string;
  readonly simulated: boolean;
}

/**
 * "Add a beneficiary" form. The account is validated on the server before it is saved: a BI-Rem
 * account must exist, a mobile-money number must pass the operator's account validation.
 */
export function BeneficiaryForm({
  providers,
}: {
  providers: readonly BeneficiaryProviderOption[];
}) {
  const [method, setMethod] = useState<'WALLET' | 'MOBILE_MONEY'>('WALLET');
  // Remount after a successful save so the fields start empty for the next beneficiary.
  const [formKey, setFormKey] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <ActionForm
      key={formKey}
      action={addBeneficiaryAction}
      className="space-y-4"
      onResult={(state) => {
        if (state.ok) {
          setSaved(state.message ?? 'Beneficiary saved');
          setMethod('WALLET');
          setFormKey((value) => value + 1);
        } else {
          setSaved(null);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="fullName" label="Full name" autoComplete="off" required maxLength={120} />
        <Input name="nickname" label="Nickname" autoComplete="off" maxLength={60} />
      </div>
      <Select
        name="method"
        label="How do they receive money?"
        required
        value={method}
        onChange={(event) =>
          setMethod(event.target.value === 'MOBILE_MONEY' ? 'MOBILE_MONEY' : 'WALLET')
        }
        options={[
          { value: 'WALLET', label: 'BI-Rem account (customer, merchant or agent)' },
          { value: 'MOBILE_MONEY', label: 'Mobile-money number' },
        ]}
      />
      {method === 'MOBILE_MONEY' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            name="providerId"
            label="Mobile-money provider"
            required
            placeholder="Choose a provider"
            options={providers.map((provider) => ({
              value: provider.id,
              label: `${provider.countryName} — ${provider.name} (${provider.currency})${provider.simulated ? ' · simulated' : ''}`,
            }))}
          />
          <Input
            name="accountNumber"
            label="Mobile-money number"
            inputMode="tel"
            autoComplete="off"
            placeholder="+244 9 23 00 01 23"
            hint="Checked with the operator before saving"
            required
          />
        </div>
      ) : (
        <Input
          name="accountNumber"
          label="Phone, e-mail or code"
          autoComplete="off"
          placeholder="+237 6 99 00 01 01, name@example.com or M-DEMO01"
          hint="The phone or e-mail of a BI-Rem customer, or a merchant / agent code"
          required
        />
      )}
      <Input
        name="relationship"
        label="Relationship"
        autoComplete="off"
        maxLength={60}
        placeholder="Family, friend, supplier…"
      />
      {saved ? (
        <p role="status" className="rounded-lg bg-success-soft px-4 py-3 text-sm text-fg">
          {saved}
        </p>
      ) : null}
      <FormMessage showSuccess={false} />
      <FormActions>
        <SubmitButton pendingLabel="Checking the account…">Save beneficiary</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
