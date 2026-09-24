import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/lib/auth/actions";
import { getContext } from "@/lib/auth/context";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Input } from "@/components/ui";
import { getT } from "@/i18n";
import { db } from "@/lib/db";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const sp = await searchParams;
  if (await getContext()) redirect("/dashboard");
  const orgCount = await db.organization.count().catch(() => 1);
  if (orgCount === 0) redirect("/setup");
  const { t } = await getT();
  const dict = { "auth.invalid": t("auth.invalid"), "auth.locked": t("auth.locked") };
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">{t("auth.signIn")}</h1>
      {sp.reset && <div className="mb-4"><Alert tone="success">Password updated. Please sign in.</Alert></div>}
      <ActionForm action={loginAction} dict={dict}>
        <Input label={t("auth.identifier")} name="identifier" autoComplete="username" required />
        <Input label={t("auth.password")} name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="w-full">{t("auth.signIn")}</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-sm">
        <Link href="/forgot-password" className="text-[var(--brand)] hover:underline">{t("auth.forgot")}</Link>
      </p>
      {process.env.NEXT_PUBLIC_DEMO_MODE === "true" && (
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <strong>Demo environment.</strong> Sign in with <code>admin@example.test</code>, <code>tenant@example.test</code>, etc.
          The demo password is documented in the README. Do not use real data.
        </div>
      )}
    </div>
  );
}
