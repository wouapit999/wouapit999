'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/cn';

import type { NavItem } from './nav';

/** Navigation link that marks itself `aria-current="page"` when it matches the current path. */
export function NavLink({
  item,
  className,
  badge,
}: {
  item: NavItem;
  className?: string;
  badge?: number;
}) {
  const pathname = usePathname();
  const active = item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const ref = useRef<HTMLAnchorElement>(null);

  // In the horizontally scrolling mobile nav the current section may start off-screen: centre
  // it. Only the scroller itself moves — the page never scrolls.
  useEffect(() => {
    const link = ref.current;
    const scroller = link?.closest('[data-nav-scroller]');
    if (!active || !link || !(scroller instanceof HTMLElement)) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const offset =
      link.getBoundingClientRect().left -
      scroller.getBoundingClientRect().left +
      scroller.scrollLeft;
    scroller.scrollLeft = Math.max(offset - (scroller.clientWidth - link.offsetWidth) / 2, 0);
  }, [active]);

  return (
    <Link
      ref={ref}
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // `relative` keeps the badge's sr-only text (position: absolute) inside the scrolling
        // mobile nav; without it the text escapes the scroll container and widens the page.
        'relative flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
        active
          ? 'bg-accent-soft text-accent'
          : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
        className,
      )}
    >
      <span>{item.label}</span>
      {badge ? (
        <span className="rounded-full bg-gold-500 px-1.5 py-0.5 text-[0.6875rem] font-semibold leading-none text-slate-950">
          {badge > 99 ? '99+' : badge}
          <span className="sr-only"> unread</span>
        </span>
      ) : null}
    </Link>
  );
}
