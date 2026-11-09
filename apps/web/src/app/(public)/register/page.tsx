import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthCard } from '@/components/auth/auth-card';
import { RegisterForm } from '@/components/auth/register-form';
import { createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';
import { PAGES } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getRequestLocale());
  return { title: t('nav.register') };
}

export default async function RegisterPage() {
  const t = createTranslator(await getRequestLocale());
  return (
    <AuthCard
      title={t('auth.register.title')}
      subtitle={t('auth.register.subtitle')}
      footer={
        <>
          {t('auth.register.hasAccount')}{' '}
          <Link
            href={PAGES.login}
            className="font-medium text-brand-700 hover:underline dark:text-brand-200"
          >
            {t('nav.login')}
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
