'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

import type { ChangePasswordDto } from '@bi-rem/shared/schemas';

import { useSubmitHandler } from '@/components/auth/use-submit';
import { PageHeader } from '@/components/dashboard/page-header';
import { useSession } from '@/components/dashboard/session-provider';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { PasswordField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import { useT } from '@/i18n/provider';
import { authApi, proxyApi } from '@/lib/api-browser';
import { type ChangePasswordFormValues, changePasswordFormSchema } from '@/lib/auth-schemas';
import { API, BFF, PAGES } from '@/lib/routes';

export function SecurityView() {
  const t = useT();
  const user = useSession();
  return (
    <div className="space-y-6">
      <PageHeader title={t('security.title')} subtitle={t('security.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChangePasswordCard />
        <div className="space-y-6">
          <Card>
            <CardHeader
              title={t('security.mfa.title')}
              action={<Badge tone="gold">{t('badge.availableSoon')}</Badge>}
            />
            <p className="text-sm text-fg-muted">{t('security.mfa.body')}</p>
            <dl className="mt-4 flex items-center justify-between text-sm">
              <dt className="text-fg-muted">{t('dashboard.kyc.status')}</dt>
              <dd>
                <Badge tone={user.mfaEnabled ? 'success' : 'neutral'}>
                  {user.mfaEnabled ? t('security.mfa.enabled') : t('security.mfa.disabled')}
                </Badge>
              </dd>
            </dl>
            <Button variant="secondary" size="sm" className="mt-4 w-full" disabled>
              {t('security.mfa.title')}
            </Button>
          </Card>
          <SessionsCard />
        </div>
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const t = useT();
  const [success, setSuccess] = useState(false);
  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { rootError, run } = useSubmitHandler(form.setError);
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) =>
    run(async () => {
      setSuccess(false);
      const dto: ChangePasswordDto = {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      };
      await proxyApi.post(API.auth.passwordChange, dto);
      form.reset();
      setSuccess(true);
    }),
  );

  return (
    <Card>
      <CardHeader title={t('security.password.title')} description={t('security.password.body')} />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {success ? <Alert tone="success">{t('security.password.success')}</Alert> : null}
        {rootError ? <ErrorState error={rootError} /> : null}
        <PasswordField
          label={t('field.currentPassword')}
          autoComplete="current-password"
          required
          error={errors.currentPassword?.message}
          {...form.register('currentPassword')}
        />
        <PasswordField
          label={t('field.newPassword')}
          autoComplete="new-password"
          required
          hint={t('auth.password.hint')}
          error={errors.newPassword?.message}
          {...form.register('newPassword')}
        />
        <PasswordField
          label={t('field.confirmPassword')}
          autoComplete="new-password"
          required
          error={errors.confirmPassword?.message}
          {...form.register('confirmPassword')}
        />
        <Button
          type="submit"
          loading={form.formState.isSubmitting}
          loadingLabel={t('state.saving')}
        >
          {t('security.password.submit')}
        </Button>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<unknown>(null);

  const signOutEverywhere = () => {
    setError(null);
    startTransition(async () => {
      try {
        await authApi.post(BFF.auth.logout, { allDevices: true }, { skipAuthRetry: true });
        router.push(PAGES.login);
        router.refresh();
      } catch (cause) {
        setError(cause);
      }
    });
  };

  return (
    <Card>
      <CardHeader title={t('security.sessions.title')} description={t('security.sessions.body')} />
      {error ? <ErrorState error={error} /> : null}
      <Button
        variant="danger"
        size="sm"
        className="mt-2"
        onClick={signOutEverywhere}
        loading={pending}
      >
        {t('security.sessions.signOutAll')}
      </Button>
    </Card>
  );
}
