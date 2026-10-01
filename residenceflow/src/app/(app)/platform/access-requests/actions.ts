"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/action";
import { approveRequest, rejectRequest } from "@/services/signup-requests";

export async function approveRequestAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("platform.organizations.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const res = await approveRequest(id, ctx.user.email || ctx.user.id);
    revalidatePath("/platform/access-requests");
    return { code: res.code, expiresAt: res.expiresAt.toISOString(), emailed: res.emailed, email: res.email };
  });
}

export async function rejectRequestAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("platform.organizations.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    await rejectRequest(id, ctx.user.email || ctx.user.id);
    revalidatePath("/platform/access-requests");
  });
}
