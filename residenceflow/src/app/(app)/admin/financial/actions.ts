"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/context";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { saveOrgSettings } from "@/services/admin";
import { LATE_FEE_TYPES, PAYMENT_METHODS, checkbox, stringList } from "../constants";

const decimal = (max: number) =>
  z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Invalid amount").refine((v) => Number(v) <= max, "Too large");

const schema = z.object({
  defaultGraceDays: z.coerce.number().int().min(0).max(90),
  lateFeeType: z.enum(LATE_FEE_TYPES),
  lateFeeValue: decimal(1_000_000_000),
  reminderDaysBefore: z.coerce.number().int().min(0).max(60),
  invoiceLeadDays: z.coerce.number().int().min(0).max(60),
  enabledPaymentMethods: stringList.pipe(z.array(z.enum(PAYMENT_METHODS))),
  separationOfDuties: checkbox,
  highValueThreshold: decimal(1_000_000_000_000),
  expenseApprovalThreshold: decimal(1_000_000_000_000),
  taxRatePercent: decimal(100),
  sharedTenancyEnabled: checkbox,
});

export async function saveFinancialSettingsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("settings.financial.manage");
    const d = schema.parse(formToObject(fd));
    if (d.lateFeeType === "PERCENT" && Number(d.lateFeeValue) > 100) throw new BusinessError("A percentage late fee cannot exceed 100.");
    if (d.enabledPaymentMethods.length === 0) throw new BusinessError("Enable at least one payment method.");
    await saveOrgSettings(ctx, { ...d, enabledPaymentMethods: [...new Set(d.enabledPaymentMethods)] }, "settings.financial_updated");
    revalidatePath("/admin/financial");
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}
