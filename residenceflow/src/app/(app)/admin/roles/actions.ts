"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { PLATFORM_ONLY } from "@/lib/permissions";
import { assertNotLastAdmin, lockOrgAdmin, requireOrgId, sanitizeRolePermissions } from "@/services/admin";
import { requireRecentReauth } from "@/services/reauth";
import { ORG_ROLE_SCOPES, stringList } from "../constants";

const id = z.string().uuid();

function slugKey(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `custom_${base || "role"}`;
}

async function uniqueKey(organizationId: string, name: string) {
  const base = slugKey(name);
  for (let i = 0; i < 50; i++) {
    const key = i === 0 ? base : `${base}_${i + 1}`;
    if (!(await db.role.findFirst({ where: { organizationId, key }, select: { id: true } }))) return key;
  }
  throw new BusinessError("Could not generate a unique role key.");
}

async function findOrgRole(organizationId: string, roleId: string) {
  const role = await db.role.findFirst({ where: { id: roleId, organizationId } });
  if (!role) throw new BusinessError("Role not found.");
  return role;
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  scope: z.enum(ORG_ROLE_SCOPES),
});

export async function createRoleAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let newId = "";
  const r = await runAction(async () => {
    const ctx = await authorize("settings.roles.manage");
    const organizationId = requireOrgId(ctx);
    const d = createSchema.parse(formToObject(fd));
    const key = await uniqueKey(organizationId, d.name);
    const role = await db.$transaction(async (tx) => {
      const created = await tx.role.create({ data: { organizationId, key, name: d.name, description: d.description, scope: d.scope, permissions: [], isSystem: false } });
      await audit(ctx, { action: "role.created", module: "roles", entityType: "Role", entityId: created.id, after: { key, name: d.name, scope: d.scope, permissions: [] } }, tx);
      return created;
    });
    newId = role.id;
  });
  if (!r.ok) return r;
  revalidatePath("/admin/roles");
  redirect(`/admin/roles/${newId}`);
}

export async function cloneRoleAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let newId = "";
  const r = await runAction(async () => {
    const ctx = await authorize("settings.roles.manage");
    const organizationId = requireOrgId(ctx);
    const source = await findOrgRole(organizationId, id.parse(fd.get("id")));
    const name = `${source.name} (copy)`.slice(0, 80);
    const key = await uniqueKey(organizationId, name);
    const permissions = source.permissions.filter((p) => !(PLATFORM_ONLY as string[]).includes(p));
    const scope = source.scope === "PLATFORM" ? "ORGANIZATION" : source.scope;
    const role = await db.$transaction(async (tx) => {
      const created = await tx.role.create({ data: { organizationId, key, name, description: source.description, scope, permissions, isSystem: false } });
      await audit(ctx, { action: "role.cloned", module: "roles", entityType: "Role", entityId: created.id, metadata: { sourceRoleId: source.id, sourceKey: source.key }, after: { key, name, scope, permissions } }, tx);
      return created;
    });
    newId = role.id;
  });
  if (!r.ok) return r;
  revalidatePath("/admin/roles");
  redirect(`/admin/roles/${newId}`);
}

const detailsSchema = z.object({ id, name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).default("") });

export async function updateRoleDetailsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("settings.roles.manage");
    const d = detailsSchema.parse(formToObject(fd));
    const role = await findOrgRole(requireOrgId(ctx), d.id);
    await db.role.update({ where: { id: role.id }, data: { name: d.name, description: d.description } });
    await audit(ctx, { action: "role.renamed", module: "roles", entityType: "Role", entityId: role.id, before: { name: role.name, description: role.description }, after: { name: d.name, description: d.description } });
    revalidatePath(`/admin/roles/${role.id}`);
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}

const permsSchema = z.object({ id, scope: z.enum(ORG_ROLE_SCOPES), permissions: stringList });

/** Permission and scope changes are sensitive: they need a recent password confirmation. */
export async function updateRolePermissionsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("settings.roles.manage");
    await requireRecentReauth(ctx);
    const organizationId = requireOrgId(ctx);
    const d = permsSchema.parse(formToObject(fd));
    await db.$transaction(async (tx) => {
      await lockOrgAdmin(tx, organizationId);
      const role = await tx.role.findFirst({ where: { id: d.id, organizationId } });
      if (!role) throw new BusinessError("Role not found.");
      if (role.scope === "PLATFORM") throw new BusinessError("Platform roles cannot be edited here.");
      const permissions = sanitizeRolePermissions(role.key, d.permissions);
      await assertNotLastAdmin(organizationId, { role: { id: role.id, permissions } }, tx);
      await tx.role.update({ where: { id: role.id }, data: { permissions, scope: d.scope } });
      const added = permissions.filter((p) => !role.permissions.includes(p));
      const removed = role.permissions.filter((p) => !permissions.includes(p));
      await audit(ctx, {
        action: "role.permissions_changed",
        module: "roles",
        entityType: "Role",
        entityId: role.id,
        metadata: { key: role.key, added, removed },
        before: { scope: role.scope, permissions: [...role.permissions].sort() },
        after: { scope: d.scope, permissions },
      }, tx);
    });
    revalidatePath(`/admin/roles/${d.id}`);
    revalidatePath("/admin/roles");
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}

const stateSchema = z.object({ id, op: z.enum(["activate", "deactivate", "archive", "restore"]) });

export async function setRoleStateAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("settings.roles.manage");
    const organizationId = requireOrgId(ctx);
    const d = stateSchema.parse(formToObject(fd));
    await db.$transaction(async (tx) => {
      await lockOrgAdmin(tx, organizationId);
      const role = await tx.role.findFirst({ where: { id: d.id, organizationId } });
      if (!role) throw new BusinessError("Role not found.");
      let data: { active?: boolean; archived?: boolean } = {};
      if (d.op === "activate") data = { active: true };
      if (d.op === "deactivate") data = { active: false };
      if (d.op === "restore") data = { archived: false };
      if (d.op === "archive") {
        if (role.isSystem) throw new BusinessError("System roles cannot be archived; deactivate them instead.");
        const assigned = await tx.userRole.count({ where: { roleId: role.id } });
        if (assigned > 0) throw new BusinessError("This role is still assigned to users. Remove it from all users before archiving.");
        data = { archived: true, active: false };
      }
      await assertNotLastAdmin(organizationId, { role: { id: role.id, ...data } }, tx);
      await tx.role.update({ where: { id: role.id }, data });
      await audit(ctx, { action: `role.${d.op}d`, module: "roles", entityType: "Role", entityId: role.id, before: { active: role.active, archived: role.archived }, after: data }, tx);
    });
    revalidatePath(`/admin/roles/${d.id}`);
    revalidatePath("/admin/roles");
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}
