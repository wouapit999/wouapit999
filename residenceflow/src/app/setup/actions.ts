"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { createEnterprise } from "@/services/enterprise";

const schema = z.object({
  orgName: z.string().trim().min(2).max(200),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(128),
  confirm: z.string().max(128),
});

/** First-run setup: creates the first organization and its administrator; only while none exists. */
export async function setupAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    if ((await db.organization.count()) > 0) throw new BusinessError("setup.alreadyDone");
    await createEnterprise(schema.parse(formToObject(fd)), { firstRunOnly: true, source: "setup" });
  });
  if (!r.ok) return r;
  redirect("/login?setup=1");
}
