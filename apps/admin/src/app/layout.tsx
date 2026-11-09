import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';
import { THEME_BOOT_SCRIPT } from '@/components/shell/theme-toggle';
import { publicEnv } from '@/env';

import './globals.css';

const appName = publicEnv.NEXT_PUBLIC_APP_NAME;

export const metadata: Metadata = {
  title: { default: `${appName} Admin`, template: `%s · ${appName} Admin` },
  description: `Back-office console for the ${appName} remittance platform.`,
  applicationName: `${appName} Admin`,
  ...(publicEnv.NEXT_PUBLIC_APP_URL
    ? { metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL) }
    : {}),
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0B6E4F' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the persisted theme before first paint; see theme-toggle.tsx. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
