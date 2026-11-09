'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PasswordField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import { useT } from '@/i18n/provider';
import { authApi } from '@/lib/api-browser';
import {
  type ResetPasswordFormValues,
  bffOkSchema,
  resetPasswordFormSchema,
} from '@/lib/auth-schemas';
import { BFF, PAGES } from '@/lib/routes';

import { useSubmitHandler } from './use-submit';

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });
  const { rootError, run } = useSubmitHandler(form.setError);

  const onSubmit = form.handleSubmit((values) =>
    run(async () => {
      await authApi.post(
        BFF.auth.resetPassword,
        { token: values.token, password: values.password },
        { schema: bffOkSchema, skipAuthRetry: true },
      );
      setDone(true);
    }),
  );

  if (done) {
    return (
      <Alert tone="success" title={t('auth.reset.success.title')}>
        <p>{t('auth.reset.success.body')}</p>
        <Link href={PAGES.login} className="mt-3 inline-block font-medium underline">
          {t('nav.login')}
        </Link>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {rootError ? <ErrorState error={rootError} /> : null}
      <input type="hidden" {...form.register('token')} />
      <PasswordField
        label={t('field.newPassword')}
        autoComplete="new-password"
        required
        hint={t('auth.password.hint')}
        error={form.formState.errors.password?.message ?? form.formState.errors.token?.message}
        {...form.register('password')}
      />
      <PasswordField
        label={t('field.confirmPassword')}
        autoComplete="new-password"
        required
        error={form.formState.errors.confirmPassword?.message}
        {...form.register('confirmPassword')}
      />
      <Button
        type="submit"
        className="w-full"
        loading={form.formState.isSubmitting}
        loadingLabel={t('state.submitting')}
      >
        {t('auth.reset.submit')}
      </Button>
    </form>
  );
}
