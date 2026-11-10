import type { Role } from '@/generated/prisma/enums';
import { type Permission, roleHasPermission } from '@/server/rbac';

/**
 * Navigation of the three areas. Area agents: add or reorder items here — the shell renders
 * whatever this file returns. Admin items are filtered by the viewer's permissions.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** Group heading (admin sidebar). */
  readonly group?: string;
  /** Match only the exact path (for area roots such as `/app`). */
  readonly exact?: boolean;
}

interface GatedNavItem extends NavItem {
  readonly permission?: Permission;
}

export const CUSTOMER_NAV: readonly NavItem[] = [
  { href: '/app', label: 'Home', exact: true },
  { href: '/app/send', label: 'Send money' },
  // Wallets also holds the top-up (`/app/wallets/topup`; `/app/topup` redirects there).
  { href: '/app/wallets', label: 'Wallets' },
  { href: '/app/transfers', label: 'Transfers' },
  { href: '/app/beneficiaries', label: 'Beneficiaries' },
  { href: '/app/kyc', label: 'Verification' },
  { href: '/app/notifications', label: 'Notifications' },
  { href: '/app/profile', label: 'Profile' },
  { href: '/app/security', label: 'Security' },
];

export const PARTNER_NAV: readonly NavItem[] = [
  { href: '/partner', label: 'Dashboard', exact: true },
  { href: '/partner/transactions', label: 'Transactions' },
  { href: '/partner/commissions', label: 'Commissions' },
  { href: '/partner/settlements', label: 'Settlements' },
  { href: '/partner/api-keys', label: 'API keys' },
  { href: '/partner/webhooks', label: 'Webhooks' },
  { href: '/partner/docs', label: 'API reference' },
  { href: '/partner/profile', label: 'Profile & security' },
];

const ADMIN_NAV: readonly GatedNavItem[] = [
  { href: '/admin', label: 'Dashboard', group: 'Operations', exact: true },
  {
    href: '/admin/transfers',
    label: 'Transfers',
    group: 'Operations',
    permission: 'transfers:read',
  },
  { href: '/admin/notifications', label: 'Notifications', group: 'Operations' },
  { href: '/admin/customers', label: 'Customers', group: 'Customers', permission: 'users:read' },
  { href: '/admin/kyc', label: 'KYC queue', group: 'Customers', permission: 'kyc:read' },
  {
    href: '/admin/compliance',
    label: 'Compliance',
    group: 'Compliance',
    permission: 'aml:read',
  },
  { href: '/admin/audit', label: 'Audit log', group: 'Compliance', permission: 'audit:read' },
  {
    href: '/admin/providers',
    label: 'Providers & rails',
    group: 'Connectivity',
    permission: 'providers:read',
  },
  {
    href: '/admin/countries',
    label: 'Countries',
    group: 'Connectivity',
    permission: 'providers:read',
  },
  { href: '/admin/fees', label: 'Fees', group: 'Treasury', permission: 'fees:read' },
  { href: '/admin/fx', label: 'FX rates', group: 'Treasury', permission: 'fx:read' },
  { href: '/admin/treasury', label: 'Treasury', group: 'Treasury', permission: 'treasury:read' },
  { href: '/admin/partners', label: 'Partners', group: 'Partners', permission: 'partners:read' },
  { href: '/admin/reports', label: 'Reports', group: 'Insights', permission: 'reports:read' },
  { href: '/admin/users', label: 'Staff & roles', group: 'System', permission: 'users:write' },
  { href: '/admin/settings', label: 'Settings', group: 'System', permission: 'settings:write' },
  { href: '/admin/security', label: 'My security', group: 'System' },
];

/** Admin navigation for a role: only the sections that role is allowed to open. */
export function adminNavFor(role: Role): NavItem[] {
  return ADMIN_NAV.filter(
    (item) => !item.permission || roleHasPermission(role, item.permission),
  ).map(({ permission: _permission, ...item }) => item);
}
