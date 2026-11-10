import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Content Security Policy. Next.js injects inline bootstrap scripts, so `'unsafe-inline'` is
 * required for `script-src` without a per-request nonce; `'unsafe-eval'` is only needed by React
 * Refresh in development. Lite talks to nothing but its own origin.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "manifest-src 'self'",
  "worker-src 'self'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig: NextConfig = {
  // Several builds / dev servers can run side by side (CI, agents) with their own dist dir.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  // Node-only packages that must not be bundled into the server build.
  serverExternalPackages: ['pg', '@prisma/adapter-pg', '@prisma/client', 'exceljs', 'pdf-lib'],
  experimental: {
    // A KYC submission carries up to four documents of 1 MB each (Vercel caps bodies at 4.5 MB).
    serverActions: { bodySizeLimit: '5mb' },
  },
  headers() {
    return Promise.resolve([
      { source: '/(.*)', headers: securityHeaders },
      {
        // The full interactive roadmap is a self-contained static file with inline scripts/styles.
        source: '/roadmap-full.html',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self' 'unsafe-inline' data: blob:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
        ],
      },
    ]);
  },
};

export default nextConfig;
