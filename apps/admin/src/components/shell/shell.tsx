'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';

import { IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';

import { CommandPalette } from './command-palette';
import { EnvBadge } from './env-badge';
import { titleForPath } from './nav';
import { Sidebar } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        Skip to content
      </a>

      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-0 h-dvh">
          <Sidebar />
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="w-72 max-w-[85vw]">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            className="flex-1 bg-slate-950/60"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface-raised/90 px-4 backdrop-blur sm:px-6">
          <IconButton
            label="Open navigation"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Icon name="menu" />
          </IconButton>
          <h2 className="min-w-0 truncate text-sm font-semibold text-fg">
            {titleForPath(pathname)}
          </h2>
          <EnvBadge />
          <div className="ml-auto flex items-center gap-2">
            <CommandPalette />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
