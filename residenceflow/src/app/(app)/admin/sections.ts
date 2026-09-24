import { hasAnyPermission, type Permission } from "@/lib/permissions";

export interface AdminSection {
  slug: string;
  any: Permission[];
}

/** Admin sub-sections and the permissions that unlock them (any of). */
export const ADMIN_SECTIONS: AdminSection[] = [
  { slug: "general", any: ["settings.general.manage"] },
  { slug: "branding", any: ["settings.branding.manage"] },
  { slug: "users", any: ["users.view"] },
  { slug: "roles", any: ["settings.roles.manage"] },
  { slug: "security", any: ["settings.security.manage"] },
  { slug: "financial", any: ["settings.financial.manage"] },
  { slug: "notifications", any: ["settings.notifications.manage"] },
  { slug: "integrations", any: ["settings.integrations.manage"] },
  { slug: "numbering", any: ["settings.general.manage"] },
  { slug: "audit-logs", any: ["audit.view"] },
  { slug: "system-status", any: ["system.status.view", "settings.general.manage"] },
];

export function visibleSections(permissions: ReadonlySet<string>) {
  return ADMIN_SECTIONS.filter((s) => hasAnyPermission(permissions, s.any));
}
