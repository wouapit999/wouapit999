import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthCard } from '@/components/auth/auth-card';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Alert } from '@/components/ui/alert';
import { createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';
import { PAGES } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getRequestLocale());
  return { title: t('auth.reset.title'), robots: { index: false } };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params] = await Promise.all([getRequestLocale().then(createTranslator), searchParams]);
  const token = typeof params.token === 'string' && params.token.length >= 20 ? params.token : null;

  return (
    <AuthCard
      title={t('auth.reset.title')}
      subtitle={t('auth.reset.subtitle')}
      footer={
        <Link
          href={PAGES.login}
          className="font-medium text-brand-700 hover:underline dark:text-brand-200"
        >
          {t('action.backToLogin')}
        </Link>
      }
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert tone="warning" title={t('auth.reset.missingToken.title')}>
          <p>{t('auth.reset.missingToken.body')}</p>
          <Link href={PAGES.forgotPassword} className="mt-3 inline-block font-medium underline">
            {t('auth.forgot.title')}
          </Link>
        </Alert>
      )}
    </AuthCard>
  );
}
