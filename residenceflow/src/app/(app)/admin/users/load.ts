import "server-only";
import { db } from "@/lib/db";
import { can, type AuthContext } from "@/lib/auth/context";
import { isPowerful } from "@/services/admin";

/** Roles the current actor may see in assignment forms, flagged with whether they may toggle them. */
export async function assignableRoles(ctx: AuthContext, heldRoleIds: string[] = []) {
  const roles = await db.role.findMany({
    where: { organizationId: ctx.organizationId || "__none__", OR: [{ active: true, archived: false }, { id: { in: heldRoleIds } }] },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  const rolesAdmin = can(ctx, "settings.roles.manage");
  return roles
    .filter((r) => r.scope !== "PLATFORM")
    .map((r) => ({
      id: r.id,
      name: r.name,
      scope: r.scope,
      powerful: isPowerful(r.permissions),
      inactive: !r.active || r.archived,
      disabled: (isPowerful(r.permissions) && !rolesAdmin) || ((!r.active || r.archived) && !heldRoleIds.includes(r.id)),
    }));
}

export function orgProperties(ctx: AuthContext) {
  return db.property.findMany({
    where: { organizationId: ctx.organizationId || "__none__", status: { not: "ARCHIVED" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, reference: true },
  });
}
