"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, tenantWhere } from "@/lib/auth/context";
import { runAction, formToObject, withMessage, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { notifyTenantUsers } from "@/services/portal";

const replySchema = z.object({
  tenantId: z.string().uuid(),
  subject: z.string().trim().max(150).default(""),
  body: z.string().trim().min(1).max(4000),
});

export async function replyToTenantAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("message.send");
    const d = replySchema.parse(formToObject(fd));
    const tenant = await db.tenant.findFirst({ where: { ...tenantWhere(ctx), id: d.tenantId }, select: { id: true } });
    if (!tenant) throw new BusinessError("Tenant not found.");
    await db.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          organizationId: ctx.organizationId,
          tenantId: tenant.id,
          fromTenant: false,
          authorId: ctx.user.id,
          authorName: ctx.user.name,
          subject: d.subject,
          body: d.body,
        },
      });
      await audit(ctx, { action: "message.sent", module: "messages", entityType: "Message", entityId: m.id, metadata: { tenantId: tenant.id, subject: d.subject } }, tx);
      const preview = d.subject || d.body.slice(0, 120);
      await notifyTenantUsers(ctx.organizationId, tenant.id, {
        en: { title: "New message from management", body: preview },
        fr: { title: "Nouveau message de la gestion", body: preview },
      }, "/portal/messages", tx);
    });
    revalidatePath(`/messages/${tenant.id}`);
  });
  revalidatePath("/messages");
  return withMessage(r, "msg.sent");
}

/** Opens (or starts) the conversation with a tenant in scope. */
export async function openThreadAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("message.view");
    const tenantId = z.string().uuid().parse(fd.get("tenantId"));
    const tenant = await db.tenant.findFirst({ where: { ...tenantWhere(ctx), id: tenantId }, select: { id: true } });
    if (!tenant) throw new BusinessError("Tenant not found.");
    id = tenant.id;
  });
  if (!r.ok) return r;
  redirect(`/messages/${id}`);
}
