import { changePasswordAction, logoutAction } from "@/lib/auth/actions";
import { requireContext } from "@/lib/auth/context";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Input, buttonClass } from "@/components/ui";
import { getT } from "@/i18n";
import { passwordDict } from "@/components/shell/password-dict";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const ctx = await requireContext(undefined, { allowPasswordChange: true });
  const { t } = await getT();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">{t("auth.changePassword")}</h1>
      {ctx.user.mustChangePassword && <div className="mb-4"><Alert tone="warn">{t("auth.mustChange")}</Alert></div>}
      <ActionForm action={changePasswordAction} dict={passwordDict(t)} resetOnSuccess>
        <Input label={t("auth.currentPassword")} name="current" type="password" autoComplete="current-password" required />
        <Input label={t("auth.newPassword")} name="password" type="password" autoComplete="new-password" required />
        <Input label={t("auth.confirmPassword")} name="confirm" type="password" autoComplete="new-password" required />
        <p className="text-xs text-slate-500">{t("password.complexity")}</p>
        <SubmitButton className="w-full">{t("common.save")}</SubmitButton>
      </ActionForm>
      <form action={logoutAction} className="mt-4">
        <button className={buttonClass("ghost")}>{t("common.signOut")}</button>
      </form>
    </div>
  );
}
