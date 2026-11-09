'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useId, useState, useTransition } from 'react';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import type { MessageKey } from '@/i18n';
import { useT } from '@/i18n/provider';
import { authApi } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { BFF, PAGES } from '@/lib/routes';

import { useSession } from './session-provider';

interface NavItem {
  href: Route;
  labelKey: MessageKey;
  icon: ReactNode;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: PAGES.dashboard, labelKey: 'nav.dashboard', icon: <HomeIcon /> },
  { href: PAGES.profile, labelKey: 'nav.profile', icon: <UserIcon /> },
  { href: PAGES.notifications, labelKey: 'nav.notifications', icon: <BellIcon /> },
  { href: PAGES.security, labelKey: 'nav.security', icon: <ShieldIcon /> },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  // The drawer remembers the path it was opened on, so navigating closes it without an effect.
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const menuOpen = openedOnPath === pathname;
  const menuId = useId();
  const closeMenu = () => setOpenedOnPath(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        className="sr-only-focusable fixed left-4 top-4 z-50 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
      >
        {t('nav.skipToContent')}
      </a>

      <aside className="hidden border-r border-border bg-surface-muted/60 lg:flex lg:flex-col">
        <div className="flex h-16 items-center px-6">
          <Link href={PAGES.dashboard} className="rounded-lg">
            <Logo />
          </Link>
        </div>
        <SidebarNav pathname={pathname} />
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-lg text-fg-muted hover:bg-surface-muted"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
              onClick={() => setOpenedOnPath(menuOpen ? null : pathname)}
            >
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
            <Link href={PAGES.dashboard} className="rounded-lg">
              <Logo compact />
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <LocaleSwitcher />
            <UserMenu />
          </div>
        </header>

        {menuOpen ? (
          <div id={menuId} className="border-b border-border bg-surface-muted lg:hidden">
            <SidebarNav pathname={pathname} />
          </div>
        ) : null}

        <main id="main" className="flex-1 px-4 py-8 sm:px-6 lg:px-10">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarNav({ pathname }: { pathname: string }) {
  const t = useT();
  return (
    <nav aria-label={t('nav.primary')} className="flex flex-col gap-1 p-4">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-600 text-white dark:bg-brand-500 dark:text-brand-950'
                : 'text-fg-muted hover:bg-surface-raised hover:text-fg',
            )}
          >
            <span aria-hidden="true" className="h-5 w-5">
              {item.icon}
            </span>
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu() {
  const t = useT();
  const user = useSession();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const logout = () => {
    startTransition(async () => {
      try {
        await authApi.post(BFF.auth.logout, undefined, { skipAuthRetry: true });
      } finally {
        router.push(PAGES.login);
        router.refresh();
      }
    });
  };

  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="hidden h-9 w-9 place-items-center rounded-full bg-gold-500 text-sm font-semibold text-gold-900 sm:grid"
      >
        {initials}
      </span>
      <span className="hidden text-sm font-medium md:inline">
        {user.firstName} {user.lastName}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={logout}
        loading={pending}
        loadingLabel={t('state.submitting')}
      >
        {t('nav.logout')}
      </Button>
    </div>
  );
}

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'h-5 w-5',
  'aria-hidden': true,
} as const;

function HomeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3Z" />
      <path d="M10 21h4" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
