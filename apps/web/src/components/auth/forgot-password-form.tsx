'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import { useT } from '@/i18n/provider';
import { authApi } from '@/lib/api-browser';
import {
  type ForgotPasswordFormValues,
  bffOkSchema,
  forgotPasswordFormSchema,
} from '@/lib/auth-schemas';
import { BFF, PAGES } from '@/lib/routes';

import { useSubmitHandler } from './use-submit';

export function ForgotPasswordForm() {
  const t = useT();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { email: '' },
  });
  const { rootError, run } = useSubmitHandler(form.setError);

  const onSubmit = form.handleSubmit((values) =>
    run(async () => {
      await authApi.post(BFF.auth.forgotPassword, values, {
        schema: bffOkSchema,
        skipAuthRetry: true,
      });
      setSentTo(values.email);
    }),
  );

  if (sentTo) {
    return (
      <Alert tone="success" title={t('auth.forgot.success.title')}>
        <p>{t('auth.forgot.success.body', { email: sentTo })}</p>
        <Link href={PAGES.login} className="mt-3 inline-block font-medium underline">
          {t('action.backToLogin')}
        </Link>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {rootError ? <ErrorState error={rootError} /> : null}
      <TextField
        label={t('field.email')}
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        error={form.formState.errors.email?.message}
        {...form.register('email')}
      />
      <Button
        type="submit"
        className="w-full"
        loading={form.formState.isSubmitting}
        loadingLabel={t('state.submitting')}
      >
        {t('auth.forgot.submit')}
      </Button>
    </form>
  );
}
