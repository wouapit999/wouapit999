'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { COUNTRIES, LIVE_COUNTRY_CODES, SUPPORTED_LOCALES } from '@bi-rem/shared/constants';
import type { UpdateProfileDto } from '@bi-rem/shared/schemas';

import { useSubmitHandler } from '@/components/auth/use-submit';
import { PageHeader } from '@/components/dashboard/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import { useI18n } from '@/i18n/provider';
import { proxyApi } from '@/lib/api-browser';
import {
  type ProfileFormValues,
  type SessionUser,
  profileFormSchema,
  sessionUserSchema,
} from '@/lib/auth-schemas';
import { API } from '@/lib/routes';

export const PROFILE_QUERY_KEY = ['users', 'me'] as const;

const COUNTRY_OPTIONS = LIVE_COUNTRY_CODES.map((code) => ({
  value: code,
  label: COUNTRIES[code].name,
}));

export function ProfileView({ initialUser }: { initialUser: SessionUser }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const query = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => proxyApi.get(API.users.me, { schema: sessionUserSchema }),
    initialData: initialUser,
  });
  const user = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('profile.title')}
        subtitle={t('profile.subtitle')}
        action={
          !editing ? (
            <Button
              variant="secondary"
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
            >
              {t('profile.edit')}
            </Button>
          ) : null
        }
      />
      {saved ? <Alert tone="success">{t('profile.saved')}</Alert> : null}
      {query.isError && !editing ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}

      {editing ? (
        <ProfileForm
          user={user}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
          }}
        />
      ) : (
        <ProfileDetails user={user} />
      )}
    </div>
  );
}

function ProfileDetails({ user }: { user: SessionUser }) {
  const { t } = useI18n();
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: t('field.firstName'), value: user.firstName },
    { label: t('field.lastName'), value: user.lastName },
    {
      label: t('field.email'),
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <span className="break-all">{user.email}</span>
          <Badge tone={user.emailVerifiedAt ? 'success' : 'warning'}>
            {user.emailVerifiedAt
              ? t('dashboard.account.emailVerified')
              : t('dashboard.account.emailUnverified')}
          </Badge>
        </span>
      ),
    },
    {
      label: t('field.phone'),
      value: user.phone ?? <span className="text-fg-subtle">{t('profile.noPhone')}</span>,
    },
    {
      label: t('field.country'),
      value: user.countryCode ? (
        COUNTRIES[user.countryCode].name
      ) : (
        <span className="text-fg-subtle">{t('profile.noCountry')}</span>
      ),
    },
    { label: t('field.locale'), value: t(`locale.${user.locale}`) },
  ];
  return (
    <Card>
      <dl className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-1 py-3 text-sm sm:grid-cols-3 sm:gap-4">
            <dt className="font-medium text-fg-muted">{row.label}</dt>
            <dd className="sm:col-span-2">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function ProfileForm({
  user,
  onCancel,
  onSaved,
}: {
  user: SessionUser;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? '',
      countryCode: user.countryCode ?? 'CM',
      locale: user.locale,
    },
  });
  const { rootError, run } = useSubmitHandler(form.setError);

  const mutation = useMutation({
    mutationFn: (dto: UpdateProfileDto) =>
      proxyApi.patch(API.users.me, dto, { schema: sessionUserSchema }),
    onSuccess: (updated) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, updated);
    },
  });

  const onSubmit = form.handleSubmit((values) =>
    run(async () => {
      const dto: UpdateProfileDto = {
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone === '' ? null : values.phone,
        countryCode: values.countryCode,
        locale: values.locale,
      };
      await mutation.mutateAsync(dto);
      onSaved();
    }),
  );
  const errors = form.formState.errors;

  return (
    <Card>
      <CardHeader title={t('profile.edit')} />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {rootError ? <ErrorState error={rootError} /> : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label={t('field.firstName')}
            autoComplete="given-name"
            required
            error={errors.firstName?.message}
            {...form.register('firstName')}
          />
          <TextField
            label={t('field.lastName')}
            autoComplete="family-name"
            required
            error={errors.lastName?.message}
            {...form.register('lastName')}
          />
        </div>
        <TextField
          label={t('field.email')}
          type="email"
          value={user.email}
          disabled
          readOnly
          hint={t('profile.emailLocked')}
        />
        <TextField
          label={t('field.phone')}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          optional
          hint={t('field.phone.hint')}
          error={errors.phone?.message}
          {...form.register('phone')}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            label={t('field.country')}
            options={COUNTRY_OPTIONS}
            error={errors.countryCode?.message}
            {...form.register('countryCode')}
          />
          <SelectField
            label={t('field.locale')}
            options={SUPPORTED_LOCALES.map((code) => ({ value: code, label: t(`locale.${code}`) }))}
            error={errors.locale?.message}
            {...form.register('locale')}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={form.formState.isSubmitting}>
            {t('action.cancel')}
          </Button>
          <Button
            type="submit"
            loading={form.formState.isSubmitting}
            loadingLabel={t('state.saving')}
          >
            {t('action.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
