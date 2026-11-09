'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icons';
import { authApi } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { fullName, initials } from '@/lib/format';
import { BFF, PAGES } from '@/lib/routes';

import { useSession } from './session-provider';

export function UserMenu() {
  const { user } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await authApi.post(BFF.auth.logout, { allDevices: false }, { skipAuthRetry: true });
    } catch {
      // Cookies are cleared by the handler even when the API revocation fails; proceed to login.
    }
    router.replace(PAGES.login);
    router.refresh();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-lg p-1 pr-2 text-left hover:bg-surface-muted"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg"
        >
          {initials(user)}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-medium text-fg">{fullName(user)}</span>
          <span className="block truncate text-xs text-fg-muted">{user.email}</span>
        </span>
        <Icon name="chevronDown" className="h-4 w-4 text-fg-subtle" />
      </button>
      <div
        id={menuId}
        role="menu"
        hidden={!open}
        className={cn(
          'absolute right-0 z-30 mt-2 w-72 rounded-card border border-border bg-surface-raised p-2 shadow-card',
        )}
      >
        <div className="px-2 py-2">
          <p className="truncate text-sm font-medium text-fg">{fullName(user)}</p>
          <p className="truncate text-xs text-fg-muted">{user.email}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {user.roles.length === 0 ? (
              <Badge tone="warning">No roles</Badge>
            ) : (
              user.roles.map((role) => (
                <Badge key={role} tone="brand">
                  {role}
                </Badge>
              ))
            )}
          </div>
          <p className="mt-2 text-xs text-fg-subtle">
            {user.permissions.length} permission{user.permissions.length === 1 ? '' : 's'}
            {user.mfaEnabled ? ' · MFA on' : ' · MFA off'}
          </p>
        </div>
        <div className="my-1 border-t border-border" />
        <button
          type="button"
          role="menuitem"
          disabled={signingOut}
          onClick={() => void signOut()}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-fg hover:bg-surface-muted disabled:opacity-60"
        >
          <Icon name="logout" className="h-4 w-4" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
