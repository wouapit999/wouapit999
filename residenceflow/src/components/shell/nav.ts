import type { Permission } from "@/lib/permissions";

export interface NavItem {
  href: string;
  key: string;
  any: Permission[];
}

export interface NavSection {
  key?: string;
  items: NavItem[];
}

export const STAFF_NAV: NavSection[] = [
  {
    items: [
      { href: "/dashboard", key: "nav.dashboard", any: ["dashboard.view"] },
      { href: "/platform", key: "nav.platform", any: ["platform.organizations.manage"] },
    ],
  },
  {
    key: "nav.section.operations",
    items: [
      { href: "/properties", key: "nav.properties", any: ["building.view"] },
      { href: "/units", key: "nav.units", any: ["unit.view"] },
      { href: "/tenants", key: "nav.tenants", any: ["tenant.view"] },
      { href: "/leases", key: "nav.leases", any: ["lease.view"] },
      { href: "/maintenance", key: "nav.maintenance", any: ["maintenance.view"] },
      { href: "/inspections", key: "nav.inspections", any: ["inspection.view"] },
      { href: "/vendors", key: "nav.vendors", any: ["vendor.view"] },
    ],
  },
  {
    key: "nav.section.finance",
    items: [
      { href: "/invoices", key: "nav.invoices", any: ["invoice.view"] },
      { href: "/payments", key: "nav.payments", any: ["payment.view"] },
      { href: "/receipts", key: "nav.receipts", any: ["receipt.view"] },
      { href: "/arrears", key: "nav.arrears", any: ["arrears.view"] },
      { href: "/deposits", key: "nav.deposits", any: ["deposit.view"] },
      { href: "/expenses", key: "nav.expenses", any: ["expense.view"] },
    ],
  },
  {
    key: "nav.section.concierge",
    items: [
      { href: "/concierge/visitors", key: "nav.visitors", any: ["concierge.visitors.manage"] },
      { href: "/concierge/parcels", key: "nav.parcels", any: ["concierge.parcels.manage"] },
      { href: "/concierge/incidents", key: "nav.incidents", any: ["concierge.incidents.manage"] },
      { href: "/concierge/shifts", key: "nav.shifts", any: ["concierge.shifts.manage"] },
    ],
  },
  {
    key: "nav.section.content",
    items: [
      { href: "/announcements", key: "nav.announcements", any: ["announcement.view"] },
      { href: "/messages", key: "nav.messages", any: ["message.view"] },
      { href: "/documents", key: "nav.documents", any: ["document.view"] },
      { href: "/reports", key: "nav.reports", any: ["report.operational.view", "report.financial.view"] },
      {
        href: "/admin/general",
        key: "nav.admin",
        any: [
          "settings.general.manage",
          "settings.branding.manage",
          "settings.roles.manage",
          "settings.security.manage",
          "users.view",
          "audit.view",
          "system.status.view",
        ],
      },
    ],
  },
];

export const PORTAL_NAV: NavItem[] = [
  { href: "/portal/home", key: "nav.portal.home", any: ["portal.access"] },
  { href: "/portal/lease", key: "nav.portal.lease", any: ["portal.access"] },
  { href: "/portal/billing", key: "nav.portal.billing", any: ["portal.access"] },
  { href: "/portal/payments", key: "nav.portal.payments", any: ["portal.access"] },
  { href: "/portal/receipts", key: "nav.portal.receipts", any: ["portal.access"] },
  { href: "/portal/maintenance", key: "nav.portal.maintenance", any: ["portal.access"] },
  { href: "/portal/documents", key: "nav.portal.documents", any: ["portal.access"] },
  { href: "/portal/messages", key: "nav.portal.messages", any: ["portal.access"] },
  { href: "/portal/profile", key: "nav.portal.profile", any: ["portal.access"] },
];
