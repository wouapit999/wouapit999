import "server-only";
import { requireTenantPortal } from "@/lib/auth/context";
import { getT, type T } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { isOccupant } from "@/services/portal";
import { portalMessages } from "./i18n";
import { notificationMessages } from "@/app/(app)/notifications/i18n";

/** Common setup for every portal page: tenant guard, translations and display preferences. */
export async function portalPage() {
  const { ctx, tenantId } = await requireTenantPortal();
  const { t, locale } = await getT(portalMessages, notificationMessages);
  const settings = await getOrgSettings(ctx.organizationId);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat ?? "dd/MM/yyyy", timezone: settings?.timezone ?? "Africa/Douala" };
  return { ctx, tenantId, t, locale, settings, fmt, df, occupant: isOccupant(ctx) };
}

/** Translations for ActionForm result keys. */
export function dictFor(t: T, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, t(k)]));
}

export const PORTAL_ERROR_KEYS = [
  "portal.msg.sent",
  "portal.lease.noticeSent",
  "portal.pay.submitted",
  "portal.profile.saved",
  "portal.profile.requestSent",
  "portal.mnt.confirmed",
  "portal.mnt.reopened",
  "portal.mnt.rated",
  "portal.err.invalidDate",
  "portal.err.pastDate",
  "portal.err.futureDate",
  "portal.err.noLease",
  "portal.err.method",
  "portal.err.amount",
  "portal.err.proofRequired",
  "portal.err.changeEmpty",
];

/** Shown to household members (occupants) on lease and financial pages. */
export function OccupantNotice({ t, title }: { t: T; title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        title={t("portal.occupant.title")}
        description={t("portal.occupant.body")}
        action={<LinkButton href="/portal/home" variant="secondary">{t("nav.portal.home")}</LinkButton>}
      />
    </>
  );
}
