import { resetPasswordAction } from "@/lib/auth/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Input } from "@/components/ui";
import { getT } from "@/i18n";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/auth/crypto";
import { passwordDict } from "@/components/shell/password-dict";

export async function TokenPasswordForm({ token, title }: { token: string; title: string }) {
  const { t } = await getT();
  const rec = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  const valid = rec && !rec.usedAt && rec.expiresAt > new Date();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
      {!valid ? (
        <Alert tone="error">{t("auth.tokenInvalid")}</Alert>
      ) : (
        <ActionForm action={resetPasswordAction} dict={passwordDict(t)}>
          <input type="hidden" name="token" value={token} />
          <Input label={t("auth.newPassword")} name="password" type="password" autoComplete="new-password" required />
          <Input label={t("auth.confirmPassword")} name="confirm" type="password" autoComplete="new-password" required />
          <p className="text-xs text-slate-500">{t("password.complexity")}</p>
          <SubmitButton className="w-full">{t("common.save")}</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

