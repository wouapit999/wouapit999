import { redirect } from "next/navigation";
import { mfaVerifyAction } from "@/lib/auth/actions";
import { readSession } from "@/lib/auth/session";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui";
import { getT } from "@/i18n";

export const metadata = { title: "Verification" };

export default async function MfaPage() {
  const s = await readSession();
  if (!s?.mfaPending) redirect("/login");
  const { t } = await getT();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">{t("auth.mfaTitle")}</h1>
      <ActionForm action={mfaVerifyAction}>
        <Input label={t("auth.mfaCode")} name="code" autoComplete="one-time-code" inputMode="text" required autoFocus />
        <SubmitButton className="w-full">{t("auth.verify")}</SubmitButton>
      </ActionForm>
    </div>
  );
}
