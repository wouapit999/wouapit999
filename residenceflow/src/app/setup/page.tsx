import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { passwordDict } from "@/components/shell/password-dict";
import { setupMessages } from "./messages";
import { setupAction } from "./actions";

export const metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

/** Public first-run page: only usable while the database has no organization. */
export default async function SetupPage() {
  if ((await db.organization.count()) > 0) redirect("/login");
  const { t, locale } = await getT(setupMessages);
  const dict = { ...passwordDict(t), "setup.alreadyDone": t("setup.alreadyDone"), "setup.emailTaken": t("setup.emailTaken") };
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{t("setup.title")}</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("setup.subtitle")}</p>
          </div>
          <LocaleSwitcher locale={locale} />
        </div>
        <ActionForm action={setupAction} dict={dict}>
          <Input label={t("setup.org")} name="orgName" required maxLength={200} />
          <Input label={t("setup.adminName")} name="adminName" required maxLength={120} autoComplete="name" />
          <Input label={t("setup.adminEmail")} name="adminEmail" type="email" required maxLength={200} autoComplete="email" />
          <Input label={t("auth.password")} name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" hint={t("setup.passwordHint")} />
          <Input label={t("auth.confirmPassword")} name="confirm" type="password" required minLength={10} maxLength={128} autoComplete="new-password" />
          <SubmitButton className="w-full">{t("setup.submit")}</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
