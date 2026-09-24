/* eslint-disable @next/next/no-img-element */
import { getPublicBranding, getOrgSettings } from "@/lib/settings";
import { getContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext().catch(() => null);
  const s = ctx?.organizationId ? await getOrgSettings(ctx.organizationId) : await getPublicBranding().catch(() => null);
  const { t, locale } = await getT();
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            {s?.logoUrl ? (
              <img src={s.logoUrl} alt="" className="h-10 w-auto dark:hidden" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand)] font-bold text-white" aria-hidden>
                {(s?.shortName ?? "RF").slice(0, 3)}
              </div>
            )}
            {s?.darkLogoUrl && <img src={s.darkLogoUrl} alt="" className="hidden h-10 w-auto dark:block" />}
            <div>
              <div className="text-lg font-semibold">{s?.appName ?? "ResidenceFlow"}</div>
              <div className="text-xs text-slate-500">{s?.companyName || t("app.tagline")}</div>
            </div>
          </div>
          {children}
          <div className="mt-8 flex items-center justify-between text-xs text-slate-500">
            <span>{s?.footerText}</span>
            <LocaleSwitcher locale={locale} />
          </div>
        </div>
      </div>
      <div
        className="hidden bg-[var(--brand)] bg-cover bg-center lg:block"
        style={s?.loginImageUrl ? { backgroundImage: `url(${s.loginImageUrl})` } : undefined}
        aria-hidden
      >
        {!s?.loginImageUrl && (
          <div className="flex h-full items-end p-12 text-white/90">
            <p className="max-w-md text-2xl font-light leading-snug">{t("app.tagline")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
