"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/context";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { getOrgSettings } from "@/lib/settings";
import { saveOrgSettings } from "@/services/admin";
import { CURRENCIES, DATE_FORMATS, FEATURE_FLAGS, LANGUAGES, TIMEZONES, checkbox, optionalText } from "../constants";

const schema = z.object({
  companyName: z.string().trim().min(1).max(200),
  appName: z.string().trim().min(1).max(60),
  shortName: z.string().trim().min(1).max(6),
  address: optionalText(300),
  phone: optionalText(40),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(200)]).default(""),
  website: z.union([z.literal(""), z.string().trim().url().max(200).refine((u) => /^https?:\/\//i.test(u), "http(s) only")]).default(""),
  taxId: optionalText(60),
  timezone: z.enum(TIMEZONES),
  dateFormat: z.enum(DATE_FORMATS),
  defaultLanguage: z.enum(LANGUAGES),
  currency: z.enum(CURRENCIES),
  financialYearStartMonth: z.coerce.number().int().min(1).max(12),
  visitorRetentionDays: z.coerce.number().int().min(1).max(3650),
  emergencyInstructions: optionalText(2000),
  flag_applications: checkbox,
  flag_utilities: checkbox,
  flag_inspections: checkbox,
  sharedTenancyEnabled: checkbox,
});

export async function saveGeneralSettingsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("settings.general.manage");
    const d = schema.parse(formToObject(fd));
    const current = await getOrgSettings(ctx.organizationId);
    const existingFlags = current?.featureFlags && typeof current.featureFlags === "object" && !Array.isArray(current.featureFlags)
      ? (current.featureFlags as Record<string, unknown>)
      : {};
    const flags: Record<string, unknown> = { ...existingFlags };
    for (const f of FEATURE_FLAGS) flags[f] = d[`flag_${f}`];
    await saveOrgSettings(ctx, {
      companyName: d.companyName,
      appName: d.appName,
      shortName: d.shortName,
      address: d.address,
      phone: d.phone,
      email: d.email,
      website: d.website,
      taxId: d.taxId,
      timezone: d.timezone,
      dateFormat: d.dateFormat,
      defaultLanguage: d.defaultLanguage,
      currency: d.currency,
      financialYearStartMonth: d.financialYearStartMonth,
      visitorRetentionDays: d.visitorRetentionDays,
      emergencyInstructions: d.emergencyInstructions,
      featureFlags: flags as never,
      sharedTenancyEnabled: d.sharedTenancyEnabled,
    }, "settings.general_updated");
    revalidatePath("/", "layout");
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}
