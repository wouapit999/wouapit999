import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicShell } from '@/components/shell/public-shell';
import {
  ActionForm,
  Alert,
  Card,
  Checkbox,
  FormMessage,
  Input,
  Select,
  SubmitButton,
  Textarea,
} from '@/components/ui';
import { getSession } from '@/server/auth/session';
import { listCountries } from '@/server/countries';
import { homePathForRole } from '@/server/rbac';

import { applyForPartnerAction } from './actions';

export const metadata: Metadata = {
  title: 'Become a partner',
  description:
    'Apply to accept BI-Rem payments as a merchant, serve customers as an agent or integrate through the API.',
};

const TYPES = [
  {
    value: 'MERCHANT',
    label: 'Merchant — accept payments',
    summary: 'Customers pay your code from their BI-Rem wallet.',
  },
  {
    value: 'AGENT',
    label: 'Agent — cash-in and cash-out',
    summary: 'Hold a float and serve customers at your counter.',
  },
  {
    value: 'PARTNER',
    label: 'API partner — send payouts',
    summary: 'Disburse to wallets and mobile money through the REST API.',
  },
] as const;

const STEPS = [
  'Send this application. It creates your login, with the application marked pending.',
  'A BI-Rem administrator reviews it and sets your commission rate.',
  'Once approved you get a wallet and a payment code, and can create API keys and webhooks.',
] as const;

/** Public partner application (phase 9): company details → PENDING partner + PARTNER login. */
export default async function PartnerApplicationPage() {
  const [session, countries] = await Promise.all([getSession(), listCountries({ enabled: true })]);
  const home = session ? homePathForRole(session.user.role) : null;

  return (
    <PublicShell signedInHome={home}>
      <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Become a partner</h1>
          <p className="mt-2 text-fg-muted">
            Merchants, agents and API partners use the same BI-Rem account: a wallet, a payment
            code, commissions and a portal.
          </p>
          <ul className="mt-6 space-y-3">
            {TYPES.map((type) => (
              <li
                key={type.value}
                className="rounded-lg border border-border bg-surface-raised p-3"
              >
                <p className="text-sm font-semibold text-fg">{type.label}</p>
                <p className="text-sm text-fg-muted">{type.summary}</p>
              </li>
            ))}
          </ul>
          <h2 className="mt-8 text-sm font-semibold text-fg">What happens next</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-fg-muted">
            {STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-fg-muted">
            BI-Rem Lite is a demonstration platform: no real funds move and mobile-money operators
            are simulated.
          </p>
        </div>

        <div className="lg:col-span-3">
          {session ? (
            <Alert tone="info" title="You are signed in" className="mb-4">
              An application creates a separate partner login with its own e-mail address.{' '}
              <Link href={home ?? '/'} className="font-medium underline">
                Back to my account
              </Link>
            </Alert>
          ) : null}
          <Card padded>
            <ActionForm action={applyForPartnerAction} className="space-y-6">
              <fieldset className="space-y-4">
                <legend className="text-base font-semibold text-fg">Your business</legend>
                <Select
                  name="type"
                  label="Partner type"
                  placeholder="Choose a type"
                  required
                  options={TYPES.map((type) => ({ value: type.value, label: type.label }))}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    name="name"
                    label="Business name"
                    autoComplete="organization"
                    required
                    minLength={2}
                    maxLength={120}
                  />
                  <Input
                    name="legalName"
                    label="Registered legal name"
                    maxLength={160}
                    hint="If different from the business name."
                  />
                </div>
                <Select
                  name="countryCode"
                  label="Country of operation"
                  placeholder="Choose a country"
                  required
                  hint="Your wallet is opened in this country's currency."
                  options={countries.map((country) => ({
                    value: country.code,
                    label: `${country.name} (${country.currency})`,
                  }))}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    name="contactPhone"
                    type="tel"
                    label="Business phone"
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="+237 6 99 00 00 01"
                    hint="International format."
                  />
                  <Input
                    name="website"
                    type="url"
                    label="Website"
                    inputMode="url"
                    placeholder="https://example.com"
                    maxLength={200}
                  />
                </div>
                <Textarea
                  name="description"
                  label="What you do and how you will use BI-Rem"
                  rows={3}
                  maxLength={1000}
                  hint="Activity, expected monthly volume, locations. Helps the review."
                />
              </fieldset>

              <fieldset className="space-y-4 border-t border-border pt-6">
                <legend className="text-base font-semibold text-fg">Your portal login</legend>
                <Input name="ownerName" label="Your full name" autoComplete="name" required />
                <Input
                  name="contactEmail"
                  type="email"
                  label="Work e-mail"
                  autoComplete="email"
                  inputMode="email"
                  required
                  hint="You sign in to the partner portal with it; BI-Rem contacts you there."
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    name="password"
                    type="password"
                    label="Password"
                    autoComplete="new-password"
                    hint="At least 10 characters, with a letter and a digit."
                    required
                    minLength={10}
                  />
                  <Input
                    name="confirmPassword"
                    type="password"
                    label="Confirm password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                  />
                </div>
              </fieldset>

              <Checkbox
                name="authorised"
                label="I am authorised to apply on behalf of this business and the information is accurate."
                required
              />
              <FormMessage />
              <SubmitButton size="lg" pendingLabel="Sending…" className="w-full sm:w-auto">
                Send application
              </SubmitButton>
              <p className="text-sm text-fg-muted">
                Already applied?{' '}
                <Link href="/login" className="font-medium text-accent hover:underline">
                  Sign in to see your status
                </Link>
              </p>
            </ActionForm>
          </Card>
        </div>
      </div>
    </PublicShell>
  );
}
