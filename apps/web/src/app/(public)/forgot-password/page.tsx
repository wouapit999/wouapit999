import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthCard } from '@/components/auth/auth-card';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';
import { PAGES } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getRequestLocale());
  return { title: t('auth.forgot.title') };
}

export default async function ForgotPasswordPage() {
  const t = createTranslator(await getRequestLocale());
  return (
    <AuthCard
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      footer={
        <Link
          href={PAGES.login}
          className="font-medium text-brand-700 hover:underline dark:text-brand-200"
        >
          {t('action.backToLogin')}
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
