'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { PAGES } from '@/lib/routes';

import { Logo } from './logo';
import { NAV_GROUPS, UPCOMING_ITEMS, isActivePath } from './nav';
import { useSession } from './session-provider';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const session = useSession();

  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-surface-sidebar text-white">
      <div className="px-5 py-5">
        <Link href={PAGES.dashboard} className="rounded-md" onClick={onNavigate}>
          <Logo />
        </Link>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => session.canAccess(item.section));
          if (items.length === 0) return null;
          return (
            <div key={group.title}>
              <p className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
                {group.title}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-white/12 text-white'
                            : 'text-white/75 hover:bg-white/8 hover:text-white',
                        )}
                      >
                        <Icon name={item.icon} className="h-4.5 w-4.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        {active ? (
                          <span
                            aria-hidden="true"
                            className="ml-auto h-1.5 w-1.5 rounded-full bg-gold-500"
                          />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        <div>
          <p className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
            Coming next
          </p>
          <ul className="space-y-0.5">
            {UPCOMING_ITEMS.map((item) => (
              <li key={item.label}>
                <span
                  aria-disabled="true"
                  title={`${item.label} arrives in ${item.phase}`}
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-white/35"
                >
                  <Icon name={item.icon} className="h-4.5 w-4.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  <Badge tone="neutral" className="ml-auto bg-white/10 text-[10px] text-white/50">
                    {item.phase}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
}
