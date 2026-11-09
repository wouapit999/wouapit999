'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';

import { PasswordField, TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { useT } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import { authApi } from '@/lib/api-browser';
import {
  type LoginFormValues,
  bffSessionResponseSchema,
  loginFormSchema,
} from '@/lib/auth-schemas';
import { BFF, PAGES, safeNextPath } from '@/lib/routes';

import { useSubmitHandler } from './use-submit';

export function LoginForm({ next }: { next: string | undefined }) {
  const t = useT();
  const router = useRouter();
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  });
  const { rootError, run } = useSubmitHandler(form.setError);

  const onSubmit = form.handleSubmit((values) =>
    run(async () => {
      try {
        await authApi.post(BFF.auth.login, values, {
          schema: bffSessionResponseSchema,
          skipAuthRetry: true,
        });
      } catch (error) {
        if (isApiError(error) && error.status === 401) {
          throw new Error(t('auth.login.invalid'));
        }
        if (isApiError(error) && error.code === 'MFA_REQUIRED') {
          throw new Error(t('auth.login.mfaUnsupported'));
        }
        throw error;
      }
      router.push(safeNextPath(next));
      router.refresh();
    }),
  );

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
      <PasswordField
        label={t('field.password')}
        autoComplete="current-password"
        required
        error={form.formState.errors.password?.message}
        {...form.register('password')}
      />
      <div className="flex items-center justify-end text-sm">
        <Link
          href={PAGES.forgotPassword}
          className="font-medium text-brand-700 hover:underline dark:text-brand-200"
        >
          {t('auth.login.forgot')}
        </Link>
      </div>
      <Button
        type="submit"
        className="w-full"
        loading={form.formState.isSubmitting}
        loadingLabel={t('state.submitting')}
      >
        {t('auth.login.submit')}
      </Button>
    </form>
  );
}
