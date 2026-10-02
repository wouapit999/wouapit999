import Link from "next/link";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui";
import { CODE_TTL_MINUTES } from "@/services/signup-requests";
import { signupMessages } from "../messages";
import { verifyCodeAction } from "../actions";

export const metadata = { title: "Access code" };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const sp = await searchParams;
  const { t } = await getT(signupMessages);
  const dict = { "signup.codeInvalid": t("signup.codeInvalid"), "signup.codeExpired": t("signup.codeExpired"), "signup.rateLimited": t("signup.rateLimited"), "signup.disabled": t("signup.disabled") };
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">{t("signup.verify.title")}</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">{t("signup.verify.subtitle", { minutes: CODE_TTL_MINUTES })}</p>
      <ActionForm action={verifyCodeAction} dict={dict}>
        <Input label={t("common.email")} name="email" type="email" required maxLength={200} defaultValue={sp.email ?? ""} autoComplete="email" />
        <Input label={t("signup.code")} name="code" required maxLength={20} inputMode="numeric" autoComplete="one-time-code" hint={t("signup.codeHint")} autoFocus={!!sp.email} />
        <SubmitButton className="w-full">{t("signup.verify.submit")}</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm"><Link href="/signup" className="text-[var(--brand)] hover:underline">{t("signup.title")}</Link></p>
    </div>
  );
}
