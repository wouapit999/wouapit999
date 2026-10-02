import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui";
import { passwordDict } from "@/components/shell/password-dict";
import { findVerified, SIGNUP_COOKIE } from "@/services/signup-requests";
import { formatDateTime } from "@/lib/format";
import { setupMessages } from "@/app/setup/messages";
import { signupMessages } from "../messages";
import { completeSignupAction } from "../actions";

export const metadata = { title: "Create your enterprise" };
export const dynamic = "force-dynamic";

export default async function CompletePage() {
  const req = await findVerified((await cookies()).get(SIGNUP_COOKIE)?.value);
  if (!req) redirect("/signup/verify?expired=1");
  const { t } = await getT(signupMessages, setupMessages);
  const dict = { ...passwordDict(t), "setup.emailTaken": t("setup.emailTaken"), "signup.sessionExpired": t("signup.sessionExpired"), "signup.disabled": t("signup.disabled") };
  const until = formatDateTime(req.verifyExpiresAt, { timezone: process.env.DEFAULT_TIMEZONE || "Africa/Douala", dateFormat: "HH:mm" }).split(" ").pop();
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">{t("signup.complete.title")}</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">{t("signup.complete.subtitle", { time: until ?? "" })}</p>
      <ActionForm action={completeSignupAction} dict={dict}>
        <Input label={t("signup.adminEmail")} name="emailDisplay" value={req.email} readOnly disabled />
        <Input label={t("signup.org")} name="orgName" required maxLength={200} defaultValue={req.orgName} />
        <Input label={t("signup.adminName")} name="adminName" required maxLength={120} defaultValue={req.name} autoComplete="name" />
        <Input label={t("auth.password")} name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" hint={t("signup.passwordHint")} />
        <Input label={t("auth.confirmPassword")} name="confirm" type="password" required minLength={10} maxLength={128} autoComplete="new-password" />
        <SubmitButton className="w-full">{t("signup.complete.submit")}</SubmitButton>
      </ActionForm>
    </div>
  );
}
