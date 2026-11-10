'use client';

import { type ChangeEvent, useState } from 'react';

import { submitKycAction } from '@/app/app/kyc/actions';
import {
  ActionForm,
  FormActions,
  FormMessage,
  Input,
  Select,
  SimulatedBadge,
  SubmitButton,
} from '@/components/ui';

export interface KycFormProps {
  /** Tiers the customer can still apply for. */
  tiers: ReadonlyArray<{ value: string; label: string; requires: string }>;
  idTypes: ReadonlyArray<{ value: string; label: string }>;
  countries: ReadonlyArray<{ value: string; label: string }>;
  defaultCountry?: string;
  /**
   * Which (simulated) vendor checks which document: `routing[idType][country]` → vendor name.
   * Computed on the server with the same routing function the service uses.
   */
  routing: Readonly<Record<string, Readonly<Record<string, string>>>>;
  maxBytes: number;
  submitLabel: string;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

const FILE_FIELDS = [
  { name: 'idFront', label: 'ID document — front', always: true },
  { name: 'idBack', label: 'ID document — back', always: false },
  { name: 'selfie', label: 'Selfie holding the document', always: false },
  { name: 'proofOfAddress', label: 'Proof of address', always: false },
] as const;

/**
 * Identity verification form: ID details plus up to four documents (≤ 1 MB each). Files are
 * checked in the browser for a friendly message and again on the server (size and content type).
 */
export function KycForm({
  tiers,
  idTypes,
  countries,
  defaultCountry,
  routing,
  maxBytes,
  submitLabel,
}: KycFormProps) {
  const [tier, setTier] = useState(tiers[0]?.value ?? 'TIER_1');
  const [idType, setIdType] = useState(idTypes[0]?.value ?? '');
  const [country, setCountry] = useState(
    countries.some((option) => option.value === defaultCountry)
      ? (defaultCountry ?? '')
      : (countries[0]?.value ?? ''),
  );
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});

  const vendor = routing[idType]?.[country];
  const megabytes = Math.round(maxBytes / (1024 * 1024));

  function checkFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    let message = '';
    if (file && file.size > maxBytes) {
      message = `This file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is ${megabytes} MB`;
      input.value = '';
    }
    setFileErrors((current) => ({ ...current, [input.name]: message }));
  }

  return (
    <ActionForm action={submitKycAction} className="space-y-4">
      <Select
        name="targetTier"
        label="Verification level"
        required
        value={tier}
        onChange={(event) => setTier(event.target.value)}
        options={tiers.map((option) => ({ value: option.value, label: option.label }))}
        hint={tiers.find((option) => option.value === tier)?.requires}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          name="idType"
          label="Document type"
          required
          value={idType}
          onChange={(event) => setIdType(event.target.value)}
          options={idTypes}
        />
        <Select
          name="idCountry"
          label="Issuing country"
          required
          value={country}
          onChange={(event) => setCountry(event.target.value)}
          options={countries}
        />
      </div>
      <Input
        name="idNumber"
        label="Document number"
        autoComplete="off"
        required
        minLength={4}
        maxLength={40}
        hint="Letters, digits, spaces, dashes and slashes"
      />

      <p
        aria-live="polite"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-fg-muted"
      >
        <span>
          Checked by:{' '}
          <span className="font-medium text-fg">{vendor ?? 'the default verification vendor'}</span>
        </span>
        <SimulatedBadge />
        <span className="w-full text-xs">
          The vendor is chosen automatically from the document type and issuing country. In BI-Rem
          Lite no real vendor is contacted: the decision is simulated.
        </span>
      </p>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-fg">
          Documents{' '}
          <span className="font-normal text-fg-muted">
            — JPEG, PNG, WebP or PDF, {megabytes} MB each at most
          </span>
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {FILE_FIELDS.map((field) => {
            const required = field.always || (field.name === 'proofOfAddress' && tier === 'TIER_2');
            return (
              <Input
                key={field.name}
                name={field.name}
                type="file"
                accept={ACCEPT}
                label={field.label}
                required={required}
                onChange={checkFile}
                error={fileErrors[field.name] ? fileErrors[field.name] : undefined}
                className="file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent"
              />
            );
          })}
        </div>
      </fieldset>

      <FormMessage />
      <FormActions>
        <SubmitButton pendingLabel="Uploading and verifying…">{submitLabel}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
