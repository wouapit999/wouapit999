import "server-only";
import { cookies } from "next/headers";
import { en, type MessageKey } from "./en";
import { fr } from "./fr";
import { getContext } from "@/lib/auth/context";

export type Locale = "en" | "fr";
export const LOCALES: Locale[] = ["en", "fr"];
export const LOCALE_COOKIE = "rf_locale";

/**
 * Module strings are co-located as `{ en: {...}, fr: {...} }` objects and merged at lookup time.
 * `t()` falls back to English, then to the key itself.
 */
export type ModuleMessages = { en: Record<string, string>; fr: Record<string, string> };

const DICTS: Record<Locale, Record<string, string>> = { en, fr };

export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const c = jar.get(LOCALE_COOKIE)?.value;
  if (c === "en" || c === "fr") return c;
  const ctx = await getContext().catch(() => null);
  if (ctx?.user.locale === "en" || ctx?.user.locale === "fr") return ctx.user.locale;
  return "fr";
}

export type T = (key: MessageKey | (string & {}), vars?: Record<string, string | number>) => string;

export function makeT(locale: Locale, ...modules: ModuleMessages[]): T {
  return (key, vars) => {
    let s: string | undefined = DICTS[locale][key];
    if (s === undefined) for (const m of modules) if (m[locale][key] !== undefined) { s = m[locale][key]; break; }
    if (s === undefined) s = DICTS.en[key];
    if (s === undefined) for (const m of modules) if (m.en[key] !== undefined) { s = m.en[key]; break; }
    if (s === undefined) s = key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export async function getT(...modules: ModuleMessages[]) {
  const locale = await getLocale();
  return { t: makeT(locale, ...modules), locale };
}
