import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'BI-Rem Lite';

export const metadata: Metadata = {
  title: { default: `${appName} — send money across Africa`, template: `%s · ${appName}` },
  description:
    'BI-Rem Lite: the BI-Rem pan-African remittance programme in one small web application — wallets, domestic and international transfers, KYC, AML, partners and reporting.',
  applicationName: appName,
  appleWebApp: { capable: true, title: appName, statusBarStyle: 'default' },
  formatDetection: { telephone: false },
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
  // English UI; strings are kept in components so fr/pt can be added later without a framework.
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
