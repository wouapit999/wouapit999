// Generates PERMISSIONS.md from src/lib/permissions.ts so documentation never drifts from code.
import { writeFileSync } from "node:fs";
import { PERMISSION_GROUPS, PLATFORM_ROLE, POWERFUL_PERMISSIONS, SYSTEM_ROLES } from "../src/lib/permissions";

const roles = [...SYSTEM_ROLES, PLATFORM_ROLE];
const short: Record<string, string> = {
  org_admin: "Admin", property_manager: "Mgr", owner: "Owner", accountant: "Acct", cashier: "Cash", concierge: "Conc",
  tenant: "Ten", occupant: "Occ", maintenance_manager: "MaintMgr", technician: "Tech", vendor: "Vend", auditor: "Aud", super_admin: "Super",
};
let md = `# Permissions\n\n_Generated from \`src/lib/permissions.ts\` by \`npm run docs:permissions\`. Do not edit by hand._\n\n`;
md += `Authorization is enforced on the server in every page (\`requireContext\`), server action (\`authorize\`), route handler and service. Record-level scope is applied through the helpers in \`src/lib/auth/context.ts\`.\n\n`;
md += `## Scopes\n\n| Scope | Meaning |\n|---|---|\n| PLATFORM | Platform operators only; no tenant or financial data |\n| ORGANIZATION | Every building of the user's organization |\n| ASSIGNED_BUILDINGS | Only buildings listed in the user's building assignments |\n| ASSIGNED_UNITS | Reserved; currently treated like ASSIGNED_BUILDINGS |\n| OWN | Own records only (tenant portal, assigned work orders, vendor jobs) |\n\nWhen a user holds several roles, permissions are unioned and the broadest scope applies.\n\n`;
md += `## Default roles\n\n| Role | Key | Scope | Description |\n|---|---|---|---|\n`;
for (const r of roles) md += `| ${r.name} | \`${r.key}\` | ${r.scope} | ${r.description} |\n`;
md += `\n## Permission matrix\n\n✔ = granted by default. Custom roles can be built from any organization permission in **Administration → Roles**.\n\n`;
md += `| Permission | ${roles.map((r) => short[r.key] ?? r.key).join(" | ")} |\n|---|${roles.map(() => ":-:").join("|")}|\n`;
for (const [group, perms] of Object.entries(PERMISSION_GROUPS)) {
  md += `| **${group}** | ${roles.map(() => "").join(" | ")} |\n`;
  for (const p of perms) {
    md += `| \`${p}\`${(POWERFUL_PERMISSIONS as string[]).includes(p) ? " ⚠" : ""} | ${roles.map((r) => ((r.permissions as string[]).includes(p) ? "✔" : "")).join(" | ")} |\n`;
  }
}
md += `\n⚠ Powerful permissions: only users holding \`settings.roles.manage\` can grant roles containing them. Changing role permissions, resetting MFA and security settings require recent re-authentication.\n\n`;
md += `## Guard rails\n\n- The last active user holding \`settings.roles.manage\` in an organization cannot be suspended, archived or stripped of it.\n- \`platform.*\` permissions can never be granted to organization roles.\n- A role cannot be archived while users are assigned to it.\n- Tenants and occupants hold only \`portal.access\`; portal queries are always filtered by the tenant bound to the user.\n- Technicians see only work orders assigned to them; vendor users only their company's work orders.\n- Concierge roles have no invoice/payment/lease permissions; the resident directory shows name, unit and phone only.\n`;
writeFileSync(new URL("../PERMISSIONS.md", import.meta.url), md);
console.log("PERMISSIONS.md written");
