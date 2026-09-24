import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BusinessError } from "@/lib/errors";
import { tenantWhere, type AuthContext } from "@/lib/auth/context";
import { issueResetToken } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/notify/email";
import { getOrgSettings } from "@/lib/settings";

/**
 * Tenant visibility for staff. Organization-wide users see every tenant; building-scoped users see
 * tenants with a lease in one of their buildings (tenantWhere) plus tenants that have no lease yet —
 * otherwise a property manager could never see (or lease a unit to) a tenant they just created.
 */
export function tenantScopeWhere(ctx: AuthContext): Prisma.TenantWhereInput {
  if (ctx.propertyIds === "ALL") return tenantWhere(ctx);
  return { OR: [tenantWhere(ctx), { organizationId: ctx.organizationId, leases: { none: {} } }] };
}

export async function loadScopedTenant(ctx: AuthContext, tenantId: string) {
  return db.tenant.findFirst({ where: { AND: [tenantScopeWhere(ctx), { id: tenantId }] } });
}

export type PortalRoleKey = "tenant" | "occupant";

type Msg = (key: string, vars?: Record<string, string | number>) => string;

const ACTIVATION_MINUTES = 72 * 60;

async function sendActivationEmail(
  ctx: AuthContext,
  to: { email: string; name: string },
  link: string,
  msg: Msg,
) {
  const settings = await getOrgSettings(ctx.organizationId);
  const appName = settings?.appName ?? "ResidenceFlow";
  const company = settings?.companyName || appName;
  const { sent } = await sendEmail({
    to: to.email,
    fromName: settings?.emailSenderName || company,
    subject: msg("tenant.portal.emailSubject", { app: appName }),
    text: msg("tenant.portal.emailBody", { name: to.name, company, link, hours: 72 }),
  });
  return sent;
}

/**
 * Creates an INVITED portal user bound to the tenant (role "tenant" or "occupant") and issues a
 * one-time activation link (72 h). The link is emailed and returned so the admin can share it once;
 * no password is ever set or seen by staff.
 */
export async function invitePortalUser(
  ctx: AuthContext,
  input: { tenantId: string; name: string; email: string; roleKey: PortalRoleKey },
  msg: Msg,
  emailMsg: Msg,
) {
  const tenant = await loadScopedTenant(ctx, input.tenantId);
  if (!tenant) throw new BusinessError(msg("tenant.err.notFound"));
  const email = input.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new BusinessError(msg("tenant.err.emailTaken"));
  const role = await db.role.findFirst({
    where: { organizationId: ctx.organizationId, key: input.roleKey, active: true, archived: false },
  });
  if (!role) throw new BusinessError(msg("tenant.err.roleMissing"));

  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        organizationId: ctx.organizationId,
        email,
        name: input.name,
        status: "INVITED",
        tenantId: tenant.id,
        locale: tenant.language === "en" ? "en" : "fr",
      },
    });
    await tx.userRole.create({ data: { userId: u.id, roleId: role.id } });
    await audit(ctx, {
      action: "users.portal_invited",
      module: "tenants",
      entityType: "User",
      entityId: u.id,
      metadata: { tenantId: tenant.id, role: input.roleKey, email },
    }, tx);
    return u;
  });

  const link = await issueResetToken(user.id, "ACTIVATION", ACTIVATION_MINUTES);
  const emailed = await sendActivationEmail(ctx, user, link, emailMsg);
  return { link, emailed };
}

/** Re-issues the activation link for a still-INVITED portal user of this tenant. */
export async function resendPortalActivation(ctx: AuthContext, input: { tenantId: string; userId: string }, msg: Msg, emailMsg: Msg) {
  const tenant = await loadScopedTenant(ctx, input.tenantId);
  if (!tenant) throw new BusinessError(msg("tenant.err.notFound"));
  const user = await db.user.findFirst({
    where: { id: input.userId, organizationId: ctx.organizationId, tenantId: tenant.id },
  });
  if (!user) throw new BusinessError(msg("tenant.err.userNotFound"));
  if (user.status !== "INVITED") throw new BusinessError(msg("tenant.err.notInvited"));
  const link = await issueResetToken(user.id, "ACTIVATION", ACTIVATION_MINUTES);
  await audit(ctx, { action: "users.activation_resent", module: "tenants", entityType: "User", entityId: user.id, metadata: { tenantId: tenant.id } });
  const emailed = await sendActivationEmail(ctx, user, link, emailMsg);
  return { link, emailed };
}
