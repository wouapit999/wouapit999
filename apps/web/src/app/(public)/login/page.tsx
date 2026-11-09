import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';
import { PAGES } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getRequestLocale());
  return { title: t('nav.login') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params] = await Promise.all([getRequestLocale().then(createTranslator), searchParams]);
  const next = typeof params.next === 'string' ? params.next : undefined;
  return (
    <AuthCard
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      footer={
        <>
          {t('auth.login.noAccount')}{' '}
          <Link
            href={PAGES.register}
            className="font-medium text-brand-700 hover:underline dark:text-brand-200"
          >
            {t('nav.register')}
          </Link>
        </>
      }
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
