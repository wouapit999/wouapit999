import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { getContext } from "@/lib/auth/context";
import { getOrgSettings, getPublicBranding } from "@/lib/settings";
import { getLocale } from "@/i18n";
import { safeBrandColor } from "@/lib/branding";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await loadBranding();
  return {
    title: { default: settings?.appName ?? "ResidenceFlow", template: `%s · ${settings?.appName ?? "ResidenceFlow"}` },
    description: "Apartment and rental property management",
    icons: settings?.iconUrl ? [{ url: settings.iconUrl }] : undefined,
  };
}

async function loadBranding() {
  try {
    const ctx = await getContext();
    if (ctx?.organizationId) return await getOrgSettings(ctx.organizationId);
    return await getPublicBranding();
  } catch {
    return null; // database unavailable: fall back to defaults
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [settings, locale, jar] = await Promise.all([loadBranding(), getLocale().catch(() => "fr"), cookies()]);
  const theme = jar.get("rf_theme")?.value === "dark" ? "dark" : "";
  const brand = safeBrandColor(settings?.primaryColor);
  return (
    <html lang={locale} className={theme} style={{ ["--brand" as string]: brand }}>
      <body>{children}</body>
    </html>
  );
}
