import Link from "next/link";
import { getT } from "@/i18n";
import { Alert } from "@/components/ui";
import { CODE_TTL_MINUTES, supportEmail } from "@/services/signup-requests";
import { signupMessages } from "../messages";

export const metadata = { title: "Request received" };
export const dynamic = "force-dynamic";

export default async function RequestedPage({ searchParams }: { searchParams: Promise<{ mail?: string }> }) {
  const sp = await searchParams;
  const { t } = await getT(signupMessages);
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">{t("signup.requested.title")}</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t("signup.requested.body", { support: supportEmail(), minutes: CODE_TTL_MINUTES })}</p>
      {sp.mail === "0" && <div className="mt-4"><Alert tone="warn">{t("signup.requested.noMail")}</Alert></div>}
      <p className="mt-6 text-sm">
        <Link href="/signup/verify" className="text-[var(--brand)] hover:underline">{t("signup.enterCode")}</Link>
      </p>
    </div>
  );
}
