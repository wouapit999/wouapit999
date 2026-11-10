import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  ActionForm,
  Card,
  Checkbox,
  FormMessage,
  Input,
  Select,
  SubmitButton,
} from '@/components/ui';
import { getSession } from '@/server/auth/session';
import { listCountries } from '@/server/countries';
import { homePathForRole } from '@/server/rbac';

import { registerAction } from '../actions';

export const metadata: Metadata = { title: 'Create an account' };

export default async function RegisterPage() {
  const session = await getSession();
  if (session) redirect(homePathForRole(session.user.role));
  const countries = await listCountries({ enabled: true });

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-fg-muted">
        A wallet in your local currency is opened automatically. Verify your identity later to raise
        your limits.
      </p>
      <Card padded className="mt-6">
        <ActionForm action={registerAction} className="space-y-4">
          <Input name="fullName" label="Full name" autoComplete="name" required />
          <Input
            name="email"
            type="email"
            label="E-mail"
            autoComplete="email"
            inputMode="email"
            required
          />
          <Select
            name="countryCode"
            label="Country of residence"
            placeholder="Choose your country"
            required
            options={countries.map((country) => ({
              value: country.code,
              label: `${country.name} (${country.currency})`,
            }))}
          />
          <Input
            name="phone"
            type="tel"
            label="Mobile number"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+237 6 99 00 00 01"
            hint="International format. Friends can send you money with it."
          />
          <Input
            name="password"
            type="password"
            label="Password"
            autoComplete="new-password"
            hint="At least 10 characters, with a letter and a digit."
            required
          />
          <Input
            name="confirmPassword"
            type="password"
            label="Confirm password"
            autoComplete="new-password"
            required
          />
          <Checkbox
            name="terms"
            label="I understand this is a demonstration platform"
            hint="No real funds move; mobile-money operators and KYC vendors are simulated."
            required
          />
          <FormMessage />
          <SubmitButton className="w-full" pendingLabel="Creating your account…">
            Create account
          </SubmitButton>
        </ActionForm>
      </Card>
      <p className="mt-4 text-center text-sm text-fg-muted">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
