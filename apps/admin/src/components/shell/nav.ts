import type { IconName } from '@/components/ui/icons';
import type { SectionKey } from '@/lib/permissions';
import { PAGES } from '@/lib/routes';

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  section: SectionKey;
  /** Keywords matched by the command palette. */
  keywords?: readonly string[];
}

export interface NavGroup {
  title: string;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: PAGES.dashboard, icon: 'dashboard', section: 'dashboard' }],
  },
  {
    title: 'Identity & access',
    items: [
      {
        label: 'Users',
        href: PAGES.users,
        icon: 'users',
        section: 'users',
        keywords: ['customers', 'admins'],
      },
      {
        label: 'Roles',
        href: PAGES.roles,
        icon: 'shield',
        section: 'roles',
        keywords: ['permissions', 'rbac'],
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        label: 'Audit log',
        href: PAGES.audit,
        icon: 'scroll',
        section: 'audit',
        keywords: ['history', 'changes'],
      },
      {
        label: 'Notification templates',
        href: PAGES.templates,
        icon: 'bell',
        section: 'templates',
        keywords: ['email', 'sms', 'messages'],
      },
    ],
  },
  {
    title: 'Platform',
    items: [
      {
        label: 'Settings',
        href: PAGES.settings,
        icon: 'settings',
        section: 'settings',
        keywords: ['feature flags', 'api keys', 'configuration'],
      },
    ],
  },
];

/** Areas delivered by later phases; shown greyed so operators know where they will live. */
export const UPCOMING_ITEMS: ReadonlyArray<{ label: string; icon: IconName; phase: string }> = [
  { label: 'KYC queue', icon: 'users', phase: 'Phase 2' },
  { label: 'Providers', icon: 'activity', phase: 'Phase 3' },
  { label: 'Transactions', icon: 'scroll', phase: 'Phase 4' },
  { label: 'Treasury', icon: 'key', phase: 'Phase 5' },
  { label: 'Compliance', icon: 'shield', phase: 'Phase 6' },
];

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Page title for the topbar derived from the current path. */
export function titleForPath(pathname: string): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (isActivePath(pathname, item.href)) return item.label;
    }
  }
  return 'Admin';
}
