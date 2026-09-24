import Link from "next/link";
import { getT } from "@/i18n";

export const metadata = { title: "Unauthorized" };

export default async function UnauthorizedPage() {
  const { t } = await getT();
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">403</h1>
      <p className="text-slate-600 dark:text-slate-300">{t("auth.unauthorized")}</p>
      <p className="mt-6 flex gap-4 text-sm">
        <Link href="/dashboard" className="text-[var(--brand)] hover:underline">{t("nav.dashboard")}</Link>
        <Link href="/login" className="text-[var(--brand)] hover:underline">{t("auth.signIn")}</Link>
      </p>
    </div>
  );
}
