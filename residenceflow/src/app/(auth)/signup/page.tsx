import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Input } from "@/components/ui";
import { passwordDict } from "@/components/shell/password-dict";
import { selfSignupEnabled } from "@/services/enterprise";
import { signupMessages } from "./messages";
import { setupMessages } from "@/app/setup/messages";
import { signupAction } from "./actions";

export const metadata = { title: "New enterprise" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getContext()) redirect("/dashboard");
  const { t } = await getT(signupMessages, setupMessages);
  const enabled = selfSignupEnabled();
  const dict = {
    ...passwordDict(t),
    "setup.emailTaken": t("setup.emailTaken"),
    "signup.disabled": t("signup.disabled"),
    "signup.badCode": t("signup.badCode"),
    "signup.rateLimited": t("signup.rateLimited"),
  };
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">{t("signup.title")}</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">{t("signup.subtitle")}</p>
      {!enabled ? (
        <Alert tone="warn">{t("signup.disabled")}</Alert>
      ) : (
        <ActionForm action={signupAction} dict={dict}>
          <Input label={t("signup.org")} name="orgName" required maxLength={200} autoComplete="organization" />
          <Input label={t("signup.adminName")} name="adminName" required maxLength={120} autoComplete="name" />
          <Input label={t("signup.adminEmail")} name="adminEmail" type="email" required maxLength={200} autoComplete="email" />
          <Input label={t("auth.password")} name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" hint={t("signup.passwordHint")} />
          <Input label={t("auth.confirmPassword")} name="confirm" type="password" required minLength={10} maxLength={128} autoComplete="new-password" />
          {process.env.SIGNUP_CODE && <Input label={t("signup.code")} name="code" required maxLength={100} hint={t("signup.codeHint")} />}
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("signup.isolation")}</p>
          <SubmitButton className="w-full">{t("signup.submit")}</SubmitButton>
        </ActionForm>
      )}
      <p className="mt-6 text-sm">
        {t("signup.haveAccount")} <Link href="/login" className="text-[var(--brand)] hover:underline">{t("auth.signIn")}</Link>
      </p>
    </div>
  );
}
