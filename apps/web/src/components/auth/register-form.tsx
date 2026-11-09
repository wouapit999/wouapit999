'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { COUNTRIES, LIVE_COUNTRY_CODES } from '@bi-rem/shared/constants';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CheckboxField, PasswordField, SelectField, TextField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import { useI18n } from '@/i18n/provider';
import { authApi } from '@/lib/api-browser';
import {
  type RegisterFormInput,
  type RegisterFormValues,
  registerFormSchema,
} from '@/lib/auth-schemas';
import { BFF, PAGES } from '@/lib/routes';

import { useSubmitHandler } from './use-submit';

const registerResponseSchema = z.object({ ok: z.literal(true), authenticated: z.boolean() });

const COUNTRY_OPTIONS = LIVE_COUNTRY_CODES.map((code) => ({
  value: code,
  label: COUNTRIES[code].name,
}));

export function RegisterForm() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [created, setCreated] = useState(false);
  const form = useForm<RegisterFormInput, unknown, RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
      phone: '',
      countryCode: 'CM',
      acceptTerms: false,
      marketingOptIn: false,
    },
  });
  const { rootError, run } = useSubmitHandler(form.setError);
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) =>
    run(async () => {
      const { confirmPassword: _confirm, phone, ...rest } = values;
      const result = await authApi.post(
        BFF.auth.register,
        { ...rest, ...(phone ? { phone } : {}), locale },
        { schema: registerResponseSchema, skipAuthRetry: true },
      );
      if (result.authenticated) {
        router.push(PAGES.dashboard);
        router.refresh();
        return;
      }
      setCreated(true);
    }),
  );

  if (created) {
    return (
      <Alert tone="success" title={t('auth.register.success.title')}>
        <p>{t('auth.register.success.body')}</p>
        <Link href={PAGES.login} className="mt-3 inline-block font-medium underline">
          {t('nav.login')}
        </Link>
      </Alert>
    );
  }

  return (
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
        autoComplete="email"
        inputMode="email"
        required
        error={errors.email?.message}
        {...form.register('email')}
      />
      <SelectField
        label={t('field.country')}
        autoComplete="country"
        required
        options={COUNTRY_OPTIONS}
        error={errors.countryCode?.message}
        {...form.register('countryCode')}
      />
      <TextField
        label={t('field.phone')}
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        optional
        hint={t('field.phone.hint')}
        placeholder="+237655123456"
        error={errors.phone?.message}
        {...form.register('phone')}
      />
      <PasswordField
        label={t('field.password')}
        autoComplete="new-password"
        required
        hint={t('auth.password.hint')}
        error={errors.password?.message}
        {...form.register('password')}
      />
      <PasswordField
        label={t('field.confirmPassword')}
        autoComplete="new-password"
        required
        error={errors.confirmPassword?.message}
        {...form.register('confirmPassword')}
      />
      <CheckboxField
        label={t('auth.register.terms')}
        error={errors.acceptTerms?.message}
        {...form.register('acceptTerms')}
      />
      <CheckboxField label={t('auth.register.marketing')} {...form.register('marketingOptIn')} />
      <Button
        type="submit"
        className="w-full"
        loading={form.formState.isSubmitting}
        loadingLabel={t('state.submitting')}
      >
        {t('auth.register.submit')}
      </Button>
    </form>
  );
}
