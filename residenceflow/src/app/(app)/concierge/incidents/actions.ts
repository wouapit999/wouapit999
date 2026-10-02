"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { authorize } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { getOrgSettings } from "@/lib/settings";
import { getT } from "@/i18n";
import { INCIDENT_KINDS, SEVERITIES, createIncident, resolveIncident } from "@/services/concierge";
import { incidentMessages } from "./messages";

const incidentSchema = z.object({
  propertyId: z.string().uuid(),
  kind: z.enum(INCIDENT_KINDS),
  severity: z.enum(SEVERITIES),
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(3).max(4000),
  occurredAt: z.string().trim().max(30).optional(),
});

export async function createIncidentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.incidents.manage");
    const d = incidentSchema.parse(formToObject(fd));
    const settings = await getOrgSettings(ctx.organizationId);
    let occurredAt = new Date();
    if (d.occurredAt) {
      const parsed = fromZonedTime(d.occurredAt, settings?.timezone ?? "Africa/Douala");
      if (!Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now() + 5 * 60_000) occurredAt = parsed;
    }
    await createIncident(ctx, { ...d, occurredAt });
    revalidatePath("/concierge/incidents");
  });
  return r.ok ? { ok: true, message: (await getT(incidentMessages)).t("inc.created") } : r;
}

export async function resolveIncidentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.incidents.manage");
    const d = z.object({ id: z.string().uuid(), note: z.string().trim().max(1000).default("") }).parse(formToObject(fd));
    await resolveIncident(ctx, d);
    revalidatePath("/concierge/incidents");
  });
  return r.ok ? { ok: true, message: (await getT(incidentMessages)).t("inc.done") } : r;
}
