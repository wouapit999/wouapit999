import type { Metadata } from 'next';
import Link from 'next/link';

import {
  ActionForm,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  DescriptionList,
  FormActions,
  FormMessage,
  Input,
  PageHeader,
  StatusBadge,
  SubmitButton,
} from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { getProfile } from '@/server/auth';
import { getPageContext } from '@/server/auth/session';
import { KYC_TIER_INFO } from '@/server/kyc';

import { updateProfileAction } from './actions';

export const metadata: Metadata = { title: 'Profile' };

/** The customer's personal details. E-mail and country are fixed after registration. */
export default async function ProfilePage() {
  const { ctx } = await getPageContext('CUSTOMER');
  const profile = await getProfile(ctx);

  return (
    <>
      <PageHeader
        title="Profile"
        description="Keep your details up to date — they are used to verify your identity."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6">
        <Card className="lg:col-span-3">
          <CardHeader title="Personal details" />
          <CardBody>
            <ActionForm action={updateProfileAction} className="space-y-4">
              <Input
                name="fullName"
                label="Full name"
                autoComplete="name"
                defaultValue={profile.fullName}
                required
                maxLength={120}
                hint="As written on your identity document"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  name="phone"
                  label="Mobile phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  defaultValue={profile.phone ?? ''}
                  placeholder={profile.country ? `${profile.country.dialCode} …` : '+…'}
                  hint="People can send you money with this number"
                />
                <Input
                  name="dateOfBirth"
                  label="Date of birth"
                  type="date"
                  autoComplete="bday"
                  defaultValue={profile.dateOfBirth?.toISOString().slice(0, 10) ?? ''}
                />
              </div>
              <Input
                name="addressLine"
                label="Address"
                autoComplete="street-address"
                defaultValue={profile.addressLine ?? ''}
                maxLength={200}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  name="city"
                  label="City"
                  autoComplete="address-level2"
                  defaultValue={profile.city ?? ''}
                  maxLength={100}
                />
                <Input
                  name="occupation"
                  label="Occupation"
                  autoComplete="organization-title"
                  defaultValue={profile.occupation ?? ''}
                  maxLength={100}
                />
              </div>
              <FormMessage />
              <FormActions>
                <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
              </FormActions>
            </ActionForm>
          </CardBody>
        </Card>

        <div className="space-y-4 lg:col-span-2 lg:space-y-6">
          <Card>
            <CardHeader title="Account" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'E-mail', value: profile.email },
                  {
                    label: 'Country of residence',
                    value: profile.country
                      ? `${profile.country.name} (${profile.country.currency})`
                      : '—',
                  },
                  { label: 'Member since', value: formatDate(profile.createdAt) },
                  { label: 'Last sign-in', value: formatDateTime(profile.lastLoginAt) },
                ]}
              />
              <p className="mt-3 text-xs text-fg-subtle">
                Your e-mail and country cannot be changed here: they define your wallet currency and
                how you sign in.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Verification"
              action={
                <StatusBadge
                  status={profile.kycStatus}
                  label={
                    profile.kycStatus === 'NONE'
                      ? 'Not verified'
                      : profile.kycStatus === 'PENDING'
                        ? 'In review'
                        : undefined
                  }
                />
              }
            />
            <CardBody>
              <p className="text-sm font-semibold text-fg">
                {KYC_TIER_INFO[profile.kycTier].label}
              </p>
              <p className="text-sm text-fg-muted">{KYC_TIER_INFO[profile.kycTier].description}</p>
            </CardBody>
            <CardFooter>
              <Link href="/app/kyc" className="font-medium text-accent hover:underline">
                Verification and limits →
              </Link>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader
              title="Security"
              action={
                <StatusBadge
                  status={profile.mfaEnabled ? 'ACTIVE' : 'INACTIVE'}
                  label={profile.mfaEnabled ? 'Two-factor on' : 'Two-factor off'}
                />
              }
            />
            <CardBody>
              <p className="text-sm text-fg-muted">
                {profile.mfaEnabled
                  ? `A 6-digit code is asked at every sign-in${profile.mfaEnabledAt ? ` (since ${formatDate(profile.mfaEnabledAt)})` : ''}.`
                  : 'Add an authenticator app to protect your account with a second factor.'}
              </p>
            </CardBody>
            <CardFooter>
              <Link href="/app/security" className="font-medium text-accent hover:underline">
                Password, two-factor and sessions →
              </Link>
            </CardFooter>
          </Card>
        </div>
      </div>
    </>
  );
}
