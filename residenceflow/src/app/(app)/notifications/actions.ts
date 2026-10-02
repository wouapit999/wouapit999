"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/auth/context";
import { runAction, withMessage, type ActionResult } from "@/lib/action";

// Notifications belong to the signed-in user only: every update filters on userId.

export async function markNotificationReadAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize();
    const id = z.string().uuid().parse(fd.get("id"));
    await db.notification.updateMany({ where: { id, userId: ctx.user.id, organizationId: ctx.organizationId, readAt: null }, data: { readAt: new Date() } });
  });
  revalidatePath("/notifications");
  revalidatePath("/portal/notifications");
  return r;
}

export async function markAllNotificationsReadAction(_p: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  void _fd;
  const r = await runAction(async () => {
    const ctx = await authorize();
    const res = await db.notification.updateMany({ where: { userId: ctx.user.id, organizationId: ctx.organizationId, readAt: null }, data: { readAt: new Date() } });
    return res.count;
  });
  revalidatePath("/notifications");
  revalidatePath("/portal/notifications");
  return withMessage(r, "notif.allRead");
}
