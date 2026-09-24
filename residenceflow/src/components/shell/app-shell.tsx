/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import type { AuthContext } from "@/lib/auth/context";
import { getOrgSettings } from "@/lib/settings";
import { hasAnyPermission } from "@/lib/permissions";
import { logoutAction, setThemeAction } from "@/lib/auth/actions";
import { getT } from "@/i18n";
import { db } from "@/lib/db";
import { LocaleSwitcher } from "./locale-switcher";
import { NavLink } from "./nav-link";
import type { NavItem, NavSection } from "./nav";

export async function AppShell({ ctx, sections, children }: { ctx: AuthContext; sections: NavSection[]; children: ReactNode }) {
  const [settings, { t, locale }, jar, unread] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    getT(),
    cookies(),
    db.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
  ]);
  const theme = jar.get("rf_theme")?.value === "dark" ? "dark" : "light";
  const visible = sections
    .map((s) => ({ ...s, items: s.items.filter((i: NavItem) => hasAnyPermission(ctx.permissions, i.any)) }))
    .filter((s) => s.items.length > 0);
  const isStaff = ctx.permissions.has("dashboard.view");

  const nav = (
    <nav aria-label="Main" className="space-y-5">
      {visible.map((s, i) => (
        <div key={i}>
          {s.key && <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t(s.key)}</div>}
          <ul className="space-y-0.5">
            {s.items.map((it) => (
              <li key={it.href}>
                <NavLink href={it.href}>{t(it.key)}</NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <Link href={isStaff ? "/dashboard" : "/portal/home"} className="flex items-center gap-2">
      {settings?.logoUrl ? (
        <>
          <img src={settings.logoUrl} alt={settings.appName} className={`h-8 w-auto ${settings.darkLogoUrl ? "dark:hidden" : ""}`} />
          {settings.darkLogoUrl && <img src={settings.darkLogoUrl} alt={settings.appName} className="hidden h-8 w-auto dark:block" />}
        </>
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--brand)] text-xs font-bold text-white" aria-hidden>
          {(settings?.shortName ?? "RF").slice(0, 3)}
        </span>
      )}
      <span className="font-semibold">{settings?.appName ?? "ResidenceFlow"}</span>
    </Link>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="no-print hidden border-r border-slate-200 bg-white px-3 py-4 dark:border-slate-800 dark:bg-slate-900 lg:block">
        <div className="mb-6 px-2">{brand}</div>
        {nav}
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <details className="relative lg:hidden">
            <summary className="cursor-pointer list-none rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600" aria-label="Menu">☰</summary>
            <div className="absolute left-0 top-10 z-30 max-h-[80vh] w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {nav}
            </div>
          </details>
          <div className="lg:hidden">{brand}</div>
          {isStaff && (
            <form action="/search" method="get" role="search" className="ml-auto hidden max-w-sm flex-1 sm:block lg:ml-0">
              <label htmlFor="global-search" className="sr-only">{t("common.search")}</label>
              <input id="global-search" name="q" placeholder={`${t("common.search")}…`} className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
            </form>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Link href={isStaff ? "/notifications" : "/portal/notifications"} className="relative rounded-md px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`${t("common.notifications")} (${unread})`}>
              🔔{unread > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
            </Link>
            <LocaleSwitcher locale={locale} />
            <form action={setThemeAction}>
              <button name="theme" value={theme === "dark" ? "light" : "dark"} className="rounded-md px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("common.theme")}>
                {theme === "dark" ? "☀️" : "🌙"}
              </button>
            </form>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                <span className="hidden sm:inline">{ctx.user.name}</span>
                <span className="sm:hidden" aria-label={ctx.user.name}>👤</span>
              </summary>
              <div className="absolute right-0 top-9 z-30 w-56 rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <div className="px-2 py-1 text-xs text-slate-500">{ctx.user.email}</div>
                <Link href={isStaff ? "/account" : "/portal/profile"} className="block rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">{t("common.profile")}</Link>
                <form action={logoutAction}>
                  <button className="w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800">{t("common.signOut")}</button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        {settings?.footerText && <footer className="no-print border-t border-slate-200 px-6 py-3 text-xs text-slate-500 dark:border-slate-800">{settings.footerText}</footer>}
      </div>
    </div>
  );
}
