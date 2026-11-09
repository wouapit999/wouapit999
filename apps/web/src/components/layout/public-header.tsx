import Link from 'next/link';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { Logo } from '@/components/logo';
import { buttonClasses } from '@/components/ui/button';
import type { Translator } from '@/i18n';
import { PAGES } from '@/lib/routes';

export function PublicHeader({ t }: { t: Translator }) {
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={PAGES.home} aria-label={t('nav.home')} className="rounded-lg">
          <Logo />
        </Link>
        <nav aria-label={t('nav.primary')} className="flex items-center gap-2 sm:gap-3">
          <LocaleSwitcher />
          <Link
            href={PAGES.login}
            className={buttonClasses('ghost', 'sm', 'hidden sm:inline-flex')}
          >
            {t('nav.login')}
          </Link>
          <Link href={PAGES.register} className={buttonClasses('primary', 'sm')}>
            {t('nav.register')}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter({ t }: { t: Translator }) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{t('footer.rights', { year: new Date().getFullYear() })}</p>
        <p>{t('footer.phase')}</p>
      </div>
    </footer>
  );
}
