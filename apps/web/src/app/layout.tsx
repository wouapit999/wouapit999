import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';
import { publicEnv } from '@/env';
import { LOCALE_TAGS, createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';

import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  const appName = publicEnv.NEXT_PUBLIC_APP_NAME;
  return {
    title: { default: `${appName} — ${t('app.tagline')}`, template: `%s · ${appName}` },
    description: t('app.description'),
    applicationName: appName,
    ...(publicEnv.NEXT_PUBLIC_APP_URL
      ? { metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL) }
      : {}),
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0B6E4F' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  return (
    <html lang={LOCALE_TAGS[locale]} suppressHydrationWarning>
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
