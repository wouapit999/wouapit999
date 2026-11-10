import Link from 'next/link';
import type { ReactNode } from 'react';

import { logoutAction } from '@/app/(auth)/actions';
import { Logo } from '@/components/logo';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { ROLE_LABELS } from '@/server/rbac';
import type { SessionUser } from '@/server/auth';

import type { NavItem } from './nav';
import { NavLink } from './nav-link';

/**
 * Shared chrome of the three signed-in areas: top bar (logo, area label, user, sign out), a
 * sidebar on desktop and a horizontally scrollable nav on mobile. Server Component — only the
 * links are client-side (to highlight the current page).
 */

export interface AppShellProps {
  /** Shown next to the logo: "Customer", "Back office", "Partner portal". */
  areaLabel: string;
  /** Where the logo links to (`/app`, `/admin`, `/partner`). */
  homeHref: string;
  user: Pick<SessionUser, 'fullName' | 'email' | 'role'>;
  nav: readonly NavItem[];
  /** Unread counts by nav href, e.g. `{ '/app/notifications': 3 }`. */
  badges?: Readonly<Record<string, number>>;
  /** Optional banner above the page content (maintenance, pending approval…). */
  banner?: ReactNode;
  children: ReactNode;
}

function groupNav(nav: readonly NavItem[]): Array<{ group: string | undefined; items: NavItem[] }> {
  const groups: Array<{ group: string | undefined; items: NavItem[] }> = [];
  for (const item of nav) {
    const last = groups[groups.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  return groups;
}

export function AppShell({
  areaLabel,
  homeHref,
  user,
  nav,
  badges = {},
  banner,
  children,
}: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only-focusable absolute left-3 top-3 z-50 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
      >
        Skip to content
      </a>

      <header className="no-print sticky top-0 z-30 border-b border-border bg-surface-raised/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={homeHref} aria-label="BI-Rem Lite home" className="shrink-0">
              <Logo />
            </Link>
            <Badge tone="brand" className="hidden sm:inline-flex">
              {areaLabel}
            </Badge>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm font-medium text-fg">{user.fullName}</p>
              <p className="truncate text-xs text-fg-subtle">{ROLE_LABELS[user.role]}</p>
            </div>
            <form action={logoutAction}>
              <button type="submit" className={buttonClasses('secondary', 'sm')}>
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Mobile navigation: one scrollable row. */}
        <nav aria-label={`${areaLabel} navigation`} className="border-t border-border lg:hidden">
          {/* The current section is scrolled into view by NavLink; the fading right edge hints
              that the row scrolls. */}
          <ul
            data-nav-scroller
            className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [&::-webkit-scrollbar]:hidden"
          >
            {nav.map((item) => (
              <li key={item.href} className="shrink-0">
                <NavLink item={item} badge={badges[item.href]} />
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-5 sm:px-6 sm:py-6">
        <nav
          aria-label={`${areaLabel} navigation`}
          className="no-print hidden w-56 shrink-0 lg:block"
        >
          <div className="sticky top-20 space-y-4">
            {groupNav(nav).map((section, index) => (
              <div key={section.group ?? index}>
                {section.group ? (
                  <p className="mb-1 px-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle">
                    {section.group}
                  </p>
                ) : null}
                <ul className="space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <NavLink item={item} badge={badges[item.href]} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <main id="main" className="min-w-0 flex-1">
          {banner ? <div className="mb-4">{banner}</div> : null}
          {children}
        </main>
      </div>

      <footer className="no-print border-t border-border bg-surface-raised">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-fg-subtle sm:px-6">
          <p>
            BI-Rem Lite — demonstration platform. Mobile-money operators and KYC vendors are
            simulated. Native mobile apps are on the roadmap (phase 11); meanwhile this web app can
            be installed on your phone.
          </p>
          <p className="flex gap-3">
            <Link href="/roadmap" className="hover:underline">
              Roadmap
            </Link>
            <Link href="/status" className="hover:underline">
              Status
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
