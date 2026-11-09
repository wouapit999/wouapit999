'use client';

import { useRouter } from 'next/navigation';
import { useId, useTransition } from 'react';

import { type Locale, SUPPORTED_LOCALES, isLocale } from '@/i18n';
import { useI18n } from '@/i18n/provider';

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Persists the preferred locale in a readable (non-httpOnly) cookie and re-renders the server
 * tree so both server and client components pick it up.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();

  const onChange = (value: string) => {
    if (!isLocale(value) || value === locale) return;
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `birem_locale=${value}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        {t('locale.label')}
      </label>
      <select
        id={id}
        value={locale}
        onChange={(event) => onChange(event.target.value)}
        disabled={pending}
        className="h-9 rounded-lg border border-border-strong bg-surface-raised px-2 text-sm text-fg"
      >
        {SUPPORTED_LOCALES.map((code: Locale) => (
          <option key={code} value={code}>
            {t(`locale.${code}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
