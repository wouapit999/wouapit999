import "server-only";
import { getOrgSettings } from "@/lib/settings";

/** Utilities module is on unless `featureFlags.utilities === false`. */
export async function utilitiesEnabled(organizationId: string) {
  const s = await getOrgSettings(organizationId);
  const flags = s?.featureFlags && typeof s.featureFlags === "object" && !Array.isArray(s.featureFlags) ? (s.featureFlags as Record<string, unknown>) : {};
  return flags.utilities !== false;
}
