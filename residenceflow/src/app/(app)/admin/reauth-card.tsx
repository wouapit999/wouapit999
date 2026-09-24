import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, Input } from "@/components/ui";
import type { T } from "@/i18n";
import { REAUTH_WINDOW_MINUTES } from "@/services/reauth";
import { reauthAction } from "./reauth-actions";

/** "Confirm password" box shown on pages with sensitive actions. */
export function ReauthCard({ ok, t }: { ok: boolean; t: T }) {
  if (ok) {
    return <Alert tone="success">{t("adm.reauth.valid", { n: REAUTH_WINDOW_MINUTES })}</Alert>;
  }
  return (
    <Card title={t("adm.reauth.title")}>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("adm.reauth.hint", { n: REAUTH_WINDOW_MINUTES })}</p>
      <ActionForm action={reauthAction} dict={reauthDict(t)}>
        <Input label={t("auth.currentPassword")} name="password" type="password" autoComplete="current-password" required wrapperClassName="max-w-sm" />
        <SubmitButton>{t("common.confirm")}</SubmitButton>
      </ActionForm>
    </Card>
  );
}

export function reauthDict(t: T): Record<string, string> {
  return {
    "adm.reauth.ok": t("adm.reauth.ok"),
    "password.currentWrong": t("password.currentWrong"),
    "auth.locked": t("auth.locked"),
    "Please confirm your password to continue.": t("adm.reauth.required"),
  };
}
