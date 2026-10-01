import { getT } from "@/i18n";
import { privacyMessages } from "./messages";

export const metadata = { title: "Privacy policy" };

/** Public privacy policy (required by the Google Play and Apple App Store listings). */
export default async function PrivacyPage() {
  const { t } = await getT(privacyMessages);
  const sections = ["data", "use", "security", "retention", "sharing", "rights", "contact"] as const;
  return (
    <article className="prose prose-slate max-w-none text-sm dark:prose-invert">
      <h1 className="text-2xl font-semibold">{t("privacy.title")}</h1>
      <p className="text-slate-600 dark:text-slate-300">{t("privacy.intro")}</p>
      {sections.map((k) => (
        <section key={k} className="mt-5">
          <h2 className="text-base font-semibold">{t(`privacy.${k}.title`)}</h2>
          <p className="text-slate-600 dark:text-slate-300">{t(`privacy.${k}.body`)}</p>
        </section>
      ))}
      <p className="mt-6 text-xs text-slate-500">{t("privacy.updated")}</p>
    </article>
  );
}
