import Link from 'next/link';
import type { ReactNode } from 'react';

import { Logo } from '@/components/logo';
import { buttonClasses } from '@/components/ui/button';

/** Chrome of the public pages (landing, roadmap, status, auth). */
export function PublicShell({
  children,
  signedInHome,
}: {
  children: ReactNode;
  /** Home path of the signed-in user, if any — swaps the auth buttons for "Open my account". */
  signedInHome?: string | null;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#main"
        className="sr-only-focusable absolute left-3 top-3 z-50 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="BI-Rem Lite home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <Link href="/roadmap" className={buttonClasses('ghost', 'sm', 'max-sm:hidden')}>
              Roadmap
            </Link>
            <Link href="/status" className={buttonClasses('ghost', 'sm', 'max-sm:hidden')}>
              Status
            </Link>
            {signedInHome ? (
              <Link href={signedInHome} className={buttonClasses('primary', 'sm')}>
                Open my account
              </Link>
            ) : (
              <>
                <Link href="/login" className={buttonClasses('secondary', 'sm')}>
                  Sign in
                </Link>
                <Link href="/register" className={buttonClasses('primary', 'sm', 'max-sm:hidden')}>
                  Create account
                </Link>
              </>
            )}
            {/* Phones: everything else sits behind one disclosure — no script needed. */}
            <details className="group relative sm:hidden">
              <summary
                aria-label="Menu"
                className={buttonClasses(
                  'ghost',
                  'sm',
                  'cursor-pointer list-none px-2.5 [&::-webkit-details-marker]:hidden',
                )}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </summary>
              <ul className="absolute right-0 top-11 z-40 w-56 rounded-xl border border-border bg-surface-raised p-1.5 shadow-lg">
                {[
                  { href: '/roadmap', label: 'Roadmap' },
                  { href: '/status', label: 'System status' },
                  { href: '/apply', label: 'Become a partner' },
                  ...(signedInHome ? [] : [{ href: '/register', label: 'Create account' }]),
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="block rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-muted"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-fg-muted sm:px-6">
          <div className="max-w-2xl space-y-1">
            <p>
              BI-Rem Lite is a demonstration platform: no real funds move, and mobile-money
              operators and KYC vendors are simulated.
            </p>
            <p>
              Install it from your browser as a web app. Native iOS and Android apps are on the{' '}
              <Link href="/roadmap#phase-11" className="underline">
                roadmap (phase 11)
              </Link>
              .
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-4">
            <Link href="/roadmap" className="hover:underline">
              Roadmap
            </Link>
            <Link href="/status" className="hover:underline">
              Status
            </Link>
            <Link href="/apply" className="hover:underline">
              Become a partner
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
