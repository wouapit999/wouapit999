import Link from "next/link";
import { forgotPasswordAction } from "@/lib/auth/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui";
import { getT } from "@/i18n";

export const metadata = { title: "Forgot password" };

export default async function ForgotPage() {
  const { t } = await getT();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">{t("auth.resetTitle")}</h1>
      <ActionForm action={forgotPasswordAction} dict={{ "auth.resetSent": t("auth.resetSent") }} resetOnSuccess>
        <Input label={t("common.email")} name="email" type="email" autoComplete="email" required />
        <SubmitButton className="w-full">{t("common.confirm")}</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-sm"><Link href="/login" className="text-[var(--brand)] hover:underline">{t("common.back")}</Link></p>
    </div>
  );
}
