import type { ReactNode } from 'react';

import { PublicFooter, PublicHeader } from '@/components/layout/public-header';
import { createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const t = createTranslator(await getRequestLocale());
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only-focusable fixed left-4 top-4 z-50 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
      >
        {t('nav.skipToContent')}
      </a>
      <PublicHeader t={t} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <PublicFooter t={t} />
    </div>
  );
}
