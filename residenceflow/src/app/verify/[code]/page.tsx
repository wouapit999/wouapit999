import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requestMeta } from "@/lib/auth/session";
import { getT } from "@/i18n";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge } from "@/components/ui";
import { verifyMessages } from "../messages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipt verification", robots: { index: false, follow: false } };

// Codes are randomToken(9): 12 base64url characters. Anything else is rejected without a DB lookup.
const CODE_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Public receipt verification (no authentication). Shows only the minimum needed to confirm
 * authenticity: receipt number, issue date, amount, issuing organization and validity.
 * No tenant personal data is ever rendered here.
 */
export default async function VerifyReceiptPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { t, locale } = await getT(verifyMessages);
  // Per-IP limit: 60 lookups per 15 minutes, tracked like other anonymous attempts.
  const meta = await requestMeta();
  const recent = await db.loginAttempt.count({ where: { ip: meta.ip, reason: "verify", createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } });
  if (recent < 60) await db.loginAttempt.create({ data: { identifier: "receipt-verify", ip: meta.ip, success: true, reason: "verify" } });
  const receipt = CODE_RE.test(code) && recent < 60
    ? await db.receipt.findUnique({
        where: { verificationCode: code },
        select: {
          number: true,
          issuedAt: true,
          snapshot: true,
          organizationId: true,
          payment: { select: { status: true, amount: true, currency: true } },
          organization: { select: { name: true, settings: { select: { companyName: true, appName: true, timezone: true, dateFormat: true } } } },
        },
      })
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{t("verify.title")}</h1>
        {!receipt ? (
          <div className="mt-4" role="status">
            <Badge tone="slate">{t("verify.notFound")}</Badge>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("verify.notFoundHint")}</p>
          </div>
        ) : (
          <VerifiedReceipt receipt={receipt} t={t} locale={locale} />
        )}
        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">{t("verify.privacy")}</p>
      </div>
    </main>
  );
}

function VerifiedReceipt({
  receipt,
  t,
  locale,
}: {
  receipt: {
    number: string;
    issuedAt: Date;
    snapshot: unknown;
    payment: { status: string; amount: { toString(): string }; currency: string };
    organization: { name: string; settings: { companyName: string; appName: string; timezone: string; dateFormat: string } | null };
  };
  t: (k: string, v?: Record<string, string | number>) => string;
  locale: string;
}) {
  const reversed = receipt.payment.status === "REVERSED";
  const snap = (receipt.snapshot ?? {}) as { organization?: { companyName?: string; appName?: string } };
  const s = receipt.organization.settings;
  const orgName = snap.organization?.companyName || s?.companyName || receipt.organization.name || snap.organization?.appName || s?.appName;
  return (
    <div className="mt-4" role="status">
      <div className="flex items-center gap-2">
        {reversed ? <Badge tone="red">{t("verify.reversed")}</Badge> : <Badge tone="green">{t("verify.valid")}</Badge>}
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{reversed ? t("verify.reversedHint") : t("verify.validHint")}</p>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm">
        <div><dt className="text-xs uppercase text-slate-500">{t("verify.number")}</dt><dd className="font-mono text-slate-900 dark:text-white">{receipt.number}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">{t("verify.issued")}</dt><dd className="text-slate-900 dark:text-white">{formatDate(receipt.issuedAt, { timezone: s?.timezone ?? "Africa/Douala", dateFormat: s?.dateFormat })}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">{t("verify.amount")}</dt><dd className="text-lg font-semibold text-slate-900 dark:text-white">{formatMoney(receipt.payment.amount, { locale, currency: receipt.payment.currency })}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">{t("verify.organization")}</dt><dd className="text-slate-900 dark:text-white">{orgName}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">{t("verify.status")}</dt><dd>{reversed ? <Badge tone="red">{t("verify.statusReversed")}</Badge> : <Badge tone="green">{t("verify.statusValid")}</Badge>}</dd></div>
      </dl>
    </div>
  );
}
