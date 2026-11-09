import type { Metadata } from 'next';
import Link from 'next/link';

import { formatDateTime } from '@bi-rem/shared/utils';

import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { LOCALE_TAGS, type MessageKey, type Translator, createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';
import { PAGES } from '@/lib/routes';
import { getSession } from '@/lib/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getRequestLocale());
  return { title: t('nav.dashboard') };
}

const STATUS_TONE = {
  PENDING_VERIFICATION: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  LOCKED: 'danger',
  DEACTIVATED: 'neutral',
} as const;

export default async function DashboardPage() {
  const [locale, session] = await Promise.all([getRequestLocale(), getSession()]);
  const t = createTranslator(locale);
  // The layout has already redirected unauthenticated visitors; this narrows the type for TS.
  if (session.status !== 'authenticated') return null;
  const { user } = session;
  const intl = LOCALE_TAGS[locale];

  return (
    <div className="space-y-8">
      <Card className="bg-gradient-to-br from-brand-600 to-brand-800 text-white dark:from-brand-700 dark:to-brand-950">
        <p className="text-sm font-medium text-brand-100">{t('nav.dashboard')}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('dashboard.welcome.title', { name: user.firstName })}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-brand-50/90">{t('dashboard.welcome.body')}</p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <Card>
          <CardHeader
            title={t('dashboard.kyc.title')}
            action={<Badge tone="gold">{t('badge.comingPhase2')}</Badge>}
          />
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm font-medium text-fg-muted">
            {t('dashboard.kyc.placeholder')}
          </p>
          <dl className="mt-4 flex items-center justify-between text-sm">
            <dt className="text-fg-muted">{t('dashboard.kyc.status')}</dt>
            <dd>
              <Badge>{t('dashboard.kyc.notStarted')}</Badge>
            </dd>
          </dl>
          <p className="mt-3 text-xs text-fg-subtle">{t('dashboard.kyc.body')}</p>
        </Card>

        <Card>
          <CardHeader title={t('dashboard.account.title')} />
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Field label={t('dashboard.account.email')}>
              <span className="break-all">{user.email}</span>{' '}
              <Badge tone={user.emailVerifiedAt ? 'success' : 'warning'}>
                {user.emailVerifiedAt
                  ? t('dashboard.account.emailVerified')
                  : t('dashboard.account.emailUnverified')}
              </Badge>
            </Field>
            <Field label={t('dashboard.account.status')}>
              <Badge tone={STATUS_TONE[user.status]}>{t(`userStatus.${user.status}`)}</Badge>
            </Field>
            <Field label={t('dashboard.account.memberSince')}>
              {formatDateTime(user.createdAt, intl, { dateStyle: 'long' })}
            </Field>
            <Field label={t('dashboard.account.lastLogin')}>
              {user.lastLoginAt
                ? formatDateTime(user.lastLoginAt, intl)
                : t('dashboard.account.never')}
            </Field>
          </dl>
        </Card>
      </div>

      <section aria-labelledby="quick-actions">
        <h2 id="quick-actions" className="mb-4 text-lg font-semibold tracking-tight">
          {t('dashboard.quick.title')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DisabledAction
            t={t}
            titleKey="dashboard.quick.send.title"
            bodyKey="dashboard.quick.send.body"
          />
          <DisabledAction
            t={t}
            titleKey="dashboard.quick.wallets.title"
            bodyKey="dashboard.quick.wallets.body"
          />
          <ActionCard
            t={t}
            titleKey="dashboard.quick.profile.title"
            bodyKey="dashboard.quick.profile.body"
            href={PAGES.profile}
            cta={t('nav.profile')}
          />
          <ActionCard
            t={t}
            titleKey="dashboard.quick.security.title"
            bodyKey="dashboard.quick.security.body"
            href={PAGES.security}
            cta={t('nav.security')}
          />
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="mt-1 text-fg">{children}</dd>
    </div>
  );
}

function DisabledAction({
  t,
  titleKey,
  bodyKey,
}: {
  t: Translator;
  titleKey: MessageKey;
  bodyKey: MessageKey;
}) {
  return (
    <Card aria-disabled="true" className="opacity-80">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{t(titleKey)}</h3>
        <Badge tone="gold">{t('badge.availableSoon')}</Badge>
      </div>
      <p className="mt-2 text-sm text-fg-muted">{t(bodyKey)}</p>
      <button type="button" disabled className={`${buttonClasses('secondary', 'sm')} mt-4 w-full`}>
        {t(titleKey)}
      </button>
    </Card>
  );
}

function ActionCard({
  t,
  titleKey,
  bodyKey,
  href,
  cta,
}: {
  t: Translator;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  href: typeof PAGES.profile | typeof PAGES.security;
  cta: string;
}) {
  return (
    <Card>
      <h3 className="font-semibold">{t(titleKey)}</h3>
      <p className="mt-2 text-sm text-fg-muted">{t(bodyKey)}</p>
      <Link href={href} className={`${buttonClasses('primary', 'sm')} mt-4 w-full`}>
        {cta}
      </Link>
    </Card>
  );
}
