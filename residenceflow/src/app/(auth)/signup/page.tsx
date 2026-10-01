import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Input } from "@/components/ui";
import { selfSignupEnabled } from "@/services/enterprise";
import { CODE_TTL_MINUTES } from "@/services/signup-requests";
import { setupMessages } from "@/app/setup/messages";
import { signupMessages } from "./messages";
import { requestAccessAction } from "./actions";

export const metadata = { title: "New enterprise" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getContext()) redirect("/dashboard");
  const { t } = await getT(signupMessages, setupMessages);
  const dict = { "setup.emailTaken": t("setup.emailTaken"), "signup.disabled": t("signup.disabled"), "signup.rateLimited": t("signup.rateLimited") };
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">{t("signup.title")}</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">{t("signup.subtitle", { minutes: CODE_TTL_MINUTES })}</p>
      {!selfSignupEnabled() ? (
        <Alert tone="warn">{t("signup.disabled")}</Alert>
      ) : (
        <ActionForm action={requestAccessAction} dict={dict}>
          <Input label={t("signup.org")} name="orgName" required maxLength={200} autoComplete="organization" />
          <Input label={t("signup.adminName")} name="adminName" required maxLength={120} autoComplete="name" />
          <Input label={t("signup.adminEmail")} name="adminEmail" type="email" required maxLength={200} autoComplete="email" />
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("signup.isolation")}</p>
          <SubmitButton className="w-full">{t("signup.request")}</SubmitButton>
        </ActionForm>
      )}
      <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>{t("signup.haveCode")} <Link href="/signup/verify" className="text-[var(--brand)] hover:underline">{t("signup.enterCode")}</Link></span>
        <span>{t("signup.haveAccount")} <Link href="/login" className="text-[var(--brand)] hover:underline">{t("auth.signIn")}</Link></span>
      </p>
    </div>
  );
}
