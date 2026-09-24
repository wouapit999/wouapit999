import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, Input } from "@/components/ui";
import type { T } from "@/i18n";
import { REAUTH_WINDOW_MINUTES } from "@/services/reauth";
import { platformReauthAction } from "./actions";

/** Translations for the keys the platform actions may return. */
export function platformDict(t: T): Record<string, string> {
  const keys = [
    "plat.created", "plat.saved", "plat.slugTaken", "plat.emailTaken", "plat.notFound",
    "sup.reauthOk", "sup.ended", "sup.alreadyActive", "sup.orgInactive", "sup.targetInvalid", "sup.notFound", "sup.notActive", "sup.resetIssued",
    "password.currentWrong", "auth.locked",
  ];
  return { ...Object.fromEntries(keys.map((k) => [k, t(k)])), "Please confirm your password to continue.": t("sup.reauthRequired") };
}

/** "Confirm password" box for sensitive platform actions (support access, administrator resets). */
export function PlatformReauthCard({ ok, t }: { ok: boolean; t: T }) {
  if (ok) return <Alert tone="success">{t("sup.reauthValid", { n: REAUTH_WINDOW_MINUTES })}</Alert>;
  return (
    <Card title={t("sup.reauthTitle")}>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("sup.reauthHint", { n: REAUTH_WINDOW_MINUTES })}</p>
      <ActionForm action={platformReauthAction} dict={platformDict(t)}>
        <Input label={t("auth.currentPassword")} name="password" type="password" autoComplete="current-password" required wrapperClassName="max-w-sm" />
        <SubmitButton>{t("common.confirm")}</SubmitButton>
      </ActionForm>
    </Card>
  );
}
