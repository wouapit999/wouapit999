// Permission catalogue and default role matrix.
// Keep in sync with PERMISSIONS.md (generated from this file by `npm run docs:permissions`).

export const PERMISSION_GROUPS = {
  dashboard: ["dashboard.view", "dashboard.financial.view"],
  building: ["building.view", "building.create", "building.update", "building.archive"],
  unit: ["unit.view", "unit.manage"],
  tenant: ["tenant.view", "tenant.create", "tenant.update", "tenant.sensitive.view", "tenant.notes.view"],
  lease: ["lease.view", "lease.create", "lease.approve", "lease.activate", "lease.terminate"],
  invoice: ["invoice.view", "invoice.create", "invoice.issue", "invoice.void"],
  payment: ["payment.view", "payment.record", "payment.approve", "payment.reverse"],
  receipt: ["receipt.view"],
  arrears: ["arrears.view", "arrears.manage"],
  deposit: ["deposit.view", "deposit.manage", "deposit.approve"],
  maintenance: [
    "maintenance.view",
    "maintenance.create",
    "maintenance.assign",
    "maintenance.update",
    "maintenance.close",
  ],
  inspection: ["inspection.view", "inspection.manage"],
  vendor: ["vendor.view", "vendor.manage"],
  expense: ["expense.view", "expense.create", "expense.approve"],
  concierge: [
    "concierge.directory.view",
    "concierge.visitors.manage",
    "concierge.parcels.manage",
    "concierge.incidents.manage",
    "concierge.shifts.manage",
  ],
  document: ["document.view", "document.upload", "document.sensitive.view"],
  announcement: ["announcement.view", "announcement.manage"],
  message: ["message.view", "message.send"],
  report: ["report.operational.view", "report.financial.view", "report.export"],
  settings: [
    "settings.general.manage",
    "settings.branding.manage",
    "settings.roles.manage",
    "settings.security.manage",
    "settings.financial.manage",
    "settings.notifications.manage",
    "settings.integrations.manage",
  ],
  users: ["users.view", "users.manage", "users.password_reset", "users.mfa_reset"],
  audit: ["audit.view", "audit.export"],
  system: ["system.status.view"],
  portal: ["portal.access"],
  platform: ["platform.organizations.manage"],
} as const;

export type Permission = (typeof PERMISSION_GROUPS)[keyof typeof PERMISSION_GROUPS][number];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSION_GROUPS).flat() as Permission[];

const ORG_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => !p.startsWith("platform.") && p !== "portal.access",
);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

/** Permissions that only platform roles may hold. */
export const PLATFORM_ONLY: Permission[] = ["platform.organizations.manage"];

/** Permissions considered "powerful" – only holders of settings.roles.manage may grant them. */
export const POWERFUL_PERMISSIONS: Permission[] = [
  "settings.roles.manage",
  "settings.security.manage",
  "users.manage",
  "users.mfa_reset",
  "payment.reverse",
];

export type RoleScopeValue =
  | "PLATFORM"
  | "ORGANIZATION"
  | "ASSIGNED_BUILDINGS"
  | "ASSIGNED_UNITS"
  | "OWN";

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  scope: RoleScopeValue;
  permissions: Permission[];
}

const readOnly = (perms: Permission[]) =>
  perms.filter((p) => p.endsWith(".view") || p === "dashboard.view");

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: "org_admin",
    name: "Organization Administrator",
    description: "Full control of the organization, its configuration, users and data.",
    scope: "ORGANIZATION",
    permissions: ORG_PERMISSIONS,
  },
  {
    key: "property_manager",
    name: "Property Manager",
    description: "Manages assigned buildings, tenants, leases and operations.",
    scope: "ASSIGNED_BUILDINGS",
    permissions: [
      "dashboard.view",
      "dashboard.financial.view",
      "building.view",
      "building.update",
      "unit.view",
      "unit.manage",
      "tenant.view",
      "tenant.create",
      "tenant.update",
      "tenant.notes.view",
      "lease.view",
      "lease.create",
      "lease.activate",
      "lease.terminate",
      "invoice.view",
      "payment.view",
      "receipt.view",
      "arrears.view",
      "arrears.manage",
      "deposit.view",
      "maintenance.view",
      "maintenance.create",
      "maintenance.assign",
      "maintenance.update",
      "maintenance.close",
      "inspection.view",
      "inspection.manage",
      "vendor.view",
      "expense.view",
      "expense.create",
      "concierge.directory.view",
      "document.view",
      "document.upload",
      "announcement.view",
      "announcement.manage",
      "message.view",
      "message.send",
      "report.operational.view",
      "report.financial.view",
      "report.export",
    ],
  },
  {
    key: "owner",
    name: "Property Owner",
    description: "Read access to owned buildings, finances and statements.",
    scope: "ASSIGNED_BUILDINGS",
    permissions: [
      "dashboard.view",
      "dashboard.financial.view",
      "building.view",
      "unit.view",
      "lease.view",
      "invoice.view",
      "payment.view",
      "arrears.view",
      "deposit.view",
      "maintenance.view",
      "expense.view",
      "expense.approve",
      "report.operational.view",
      "report.financial.view",
      "report.export",
      "announcement.view",
    ],
  },
  {
    key: "accountant",
    name: "Accountant / Finance Officer",
    description: "Invoices, payments, reconciliation, deposits and expenses.",
    scope: "ORGANIZATION",
    permissions: [
      "dashboard.view",
      "dashboard.financial.view",
      "building.view",
      "unit.view",
      "tenant.view",
      "lease.view",
      "invoice.view",
      "invoice.create",
      "invoice.issue",
      "invoice.void",
      "payment.view",
      "payment.record",
      "payment.approve",
      "payment.reverse",
      "receipt.view",
      "arrears.view",
      "arrears.manage",
      "deposit.view",
      "deposit.manage",
      "deposit.approve",
      "vendor.view",
      "vendor.manage",
      "expense.view",
      "expense.create",
      "expense.approve",
      "document.view",
      "announcement.view",
      "report.operational.view",
      "report.financial.view",
      "report.export",
    ],
  },
  {
    key: "cashier",
    name: "Cashier / Rent Collector",
    description: "Records payments and issues receipts.",
    scope: "ASSIGNED_BUILDINGS",
    permissions: [
      "dashboard.view",
      "building.view",
      "unit.view",
      "tenant.view",
      "invoice.view",
      "payment.view",
      "payment.record",
      "receipt.view",
      "announcement.view",
    ],
  },
  {
    key: "concierge",
    name: "Concierge / Security Desk",
    description: "Visitors, parcels, incidents, shifts and building notices.",
    scope: "ASSIGNED_BUILDINGS",
    permissions: [
      "dashboard.view",
      "building.view",
      "concierge.directory.view",
      "concierge.visitors.manage",
      "concierge.parcels.manage",
      "concierge.incidents.manage",
      "concierge.shifts.manage",
      "maintenance.create",
      "maintenance.view",
      "announcement.view",
    ],
  },
  {
    key: "tenant",
    name: "Tenant",
    description: "Tenant self-service portal. Own records only.",
    scope: "OWN",
    permissions: ["portal.access"],
  },
  {
    key: "occupant",
    name: "Occupant / Household Member",
    description: "Limited portal: announcements and maintenance requests.",
    scope: "OWN",
    permissions: ["portal.access"],
  },
  {
    key: "maintenance_manager",
    name: "Maintenance Manager",
    description: "Triage, assign and close work orders; manage vendors.",
    scope: "ASSIGNED_BUILDINGS",
    permissions: [
      "dashboard.view",
      "building.view",
      "unit.view",
      "maintenance.view",
      "maintenance.create",
      "maintenance.assign",
      "maintenance.update",
      "maintenance.close",
      "inspection.view",
      "inspection.manage",
      "vendor.view",
      "vendor.manage",
      "expense.view",
      "expense.create",
      "announcement.view",
      "report.operational.view",
    ],
  },
  {
    key: "technician",
    name: "Maintenance Technician",
    description: "Works on assigned work orders only.",
    scope: "OWN",
    permissions: ["dashboard.view", "maintenance.view", "maintenance.update", "announcement.view"],
  },
  {
    key: "vendor",
    name: "Vendor / Contractor",
    description: "Sees only work orders assigned to their company.",
    scope: "OWN",
    permissions: ["dashboard.view", "maintenance.view", "maintenance.update"],
  },
  {
    key: "auditor",
    name: "Auditor (read-only)",
    description: "Read-only access to records, reports and audit history.",
    scope: "ORGANIZATION",
    permissions: [
      ...readOnly(ORG_PERMISSIONS),
      "audit.view",
    ],
  },
];

export const PLATFORM_ROLE: SystemRoleDef = {
  key: "super_admin",
  name: "Platform Super Administrator",
  description: "Operates the platform: organizations, health, feature flags.",
  scope: "PLATFORM",
  permissions: ["platform.organizations.manage", "system.status.view"],
};

/** Pure permission evaluation — used by the server context and unit tests. */
export function hasPermission(granted: ReadonlySet<string>, required: Permission | Permission[]) {
  const list = Array.isArray(required) ? required : [required];
  return list.every((p) => granted.has(p));
}

export function hasAnyPermission(granted: ReadonlySet<string>, required: Permission[]) {
  return required.some((p) => granted.has(p));
}

/** Broadest scope wins when a user holds several roles. */
const SCOPE_RANK: Record<RoleScopeValue, number> = {
  OWN: 0,
  ASSIGNED_UNITS: 1,
  ASSIGNED_BUILDINGS: 2,
  ORGANIZATION: 3,
  PLATFORM: 4,
};

export function broadestScope(scopes: RoleScopeValue[]): RoleScopeValue {
  return scopes.reduce<RoleScopeValue>(
    (acc, s) => (SCOPE_RANK[s] > SCOPE_RANK[acc] ? s : acc),
    "OWN",
  );
}
