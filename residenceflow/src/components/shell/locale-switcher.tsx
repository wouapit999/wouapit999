import { setLocaleAction } from "@/lib/auth/actions";

export function LocaleSwitcher({ locale }: { locale: string }) {
  return (
    <form action={setLocaleAction} className="flex items-center gap-1">
      <button name="locale" value="en" aria-pressed={locale === "en"} className={`rounded px-1.5 py-0.5 text-xs ${locale === "en" ? "bg-slate-200 font-semibold dark:bg-slate-700" : "hover:underline"}`}>EN</button>
      <button name="locale" value="fr" aria-pressed={locale === "fr"} className={`rounded px-1.5 py-0.5 text-xs ${locale === "fr" ? "bg-slate-200 font-semibold dark:bg-slate-700" : "hover:underline"}`}>FR</button>
    </form>
  );
}
