"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { authorize } from "@/lib/auth/context";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { validateImage } from "@/lib/branding";
import { saveOrgSettings } from "@/services/admin";
import { checkbox, optionalText } from "../constants";

const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Invalid colour").transform((s) => s.toLowerCase());

const schema = z.object({
  primaryColor: hex,
  secondaryColor: hex,
  accentColor: hex,
  successColor: hex,
  warningColor: hex,
  errorColor: hex,
  emailSenderName: optionalText(100),
  replyToEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(200)]).default(""),
  footerText: optionalText(500),
  invoiceHeader: optionalText(1000),
  invoiceFooter: optionalText(1000),
  receiptFooter: optionalText(1000),
  remove_logoUrl: checkbox,
  remove_darkLogoUrl: checkbox,
  remove_iconUrl: checkbox,
  remove_loginImageUrl: checkbox,
});

const IMAGE_FIELDS = ["logoUrl", "darkLogoUrl", "iconUrl", "loginImageUrl"] as const;

async function toDataUrl(file: File, field: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const err = validateImage(bytes, mime);
  if (err) throw new BusinessError(`${field}: ${err}`);
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function saveBrandingAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("settings.branding.manage");
    const d = schema.parse(formToObject(fd));
    const data: Prisma.OrganizationSettingsUpdateInput = {
      primaryColor: d.primaryColor,
      secondaryColor: d.secondaryColor,
      accentColor: d.accentColor,
      successColor: d.successColor,
      warningColor: d.warningColor,
      errorColor: d.errorColor,
      emailSenderName: d.emailSenderName,
      replyToEmail: d.replyToEmail,
      footerText: d.footerText,
      invoiceHeader: d.invoiceHeader,
      invoiceFooter: d.invoiceFooter,
      receiptFooter: d.receiptFooter,
    };
    for (const f of IMAGE_FIELDS) {
      const file = fd.get(`file_${f}`);
      if (d[`remove_${f}`]) data[f] = null;
      else if (file instanceof File && file.size > 0) data[f] = await toDataUrl(file, f);
    }
    await saveOrgSettings(ctx, data, "settings.branding_updated");
    revalidatePath("/", "layout");
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}
