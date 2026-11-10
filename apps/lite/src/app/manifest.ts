import type { MetadataRoute } from 'next';

/** Web app manifest — makes BI-Rem Lite installable (phase 11: mobile-first PWA). */
export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.NEXT_PUBLIC_APP_NAME ?? 'BI-Rem Lite';
  return {
    id: '/',
    name,
    short_name: 'BI-Rem',
    description: 'Send money across Africa — wallets, mobile money and international transfers.',
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0B6E4F',
    lang: 'en',
    categories: ['finance'],
    shortcuts: [
      { name: 'Send money', url: '/app/send', description: 'Send to a wallet or mobile money' },
      { name: 'Roadmap', url: '/roadmap', description: 'The 13 phases of the BI-Rem programme' },
      { name: 'System status', url: '/status' },
    ],
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
