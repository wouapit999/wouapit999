'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PasswordField, TextField } from '@/components/ui/field';
import { authApi } from '@/lib/api-browser';
import { BFF, safeNextPath } from '@/lib/routes';
import { type LoginFormValues, bffSessionResponseSchema, loginFormSchema } from '@/lib/schemas';

import { useSubmit } from './use-submit';

export function LoginForm({ next }: { next: string | undefined }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  });
  const { run, formError, submitting } = useSubmit<LoginFormValues>(setError);

  const onSubmit = handleSubmit(async (values) => {
    const result = await run(
      () =>
        authApi.post(BFF.auth.login, values, {
          schema: bffSessionResponseSchema,
          skipAuthRetry: true,
        }),
      ['email', 'password'],
    );
    if (result) {
      router.replace(safeNextPath(next));
      router.refresh();
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-busy={submitting}>
      {formError ? (
        <Alert tone="danger" title="Sign-in failed">
          {formError}
        </Alert>
      ) : null}
      <TextField
        label="Work email"
        type="email"
        autoComplete="username"
        inputMode="email"
        placeholder="you@bi-rem.com"
        error={errors.email?.message}
        {...register('email')}
      />
      <PasswordField
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={submitting}
        loadingLabel="Signing in"
      >
        Sign in
      </Button>
      <p className="text-center text-xs text-fg-subtle">
        Administrator accounts only. Every action you take is recorded in the audit log.
      </p>
    </form>
  );
}
