import { requireContext } from "@/lib/auth/context";
import { emailConfigured } from "@/lib/notify/email";
import { getT } from "@/i18n";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { adminMessages } from "../messages";

export const metadata = { title: "Integrations" };

const has = (...keys: string[]) => keys.every((k) => Boolean(process.env[k]));
const any = (...keys: string[]) => keys.some((k) => Boolean(process.env[k]));

/** Status derived from the presence of environment variables only — values are never displayed. */
export default async function IntegrationsPage() {
  await requireContext("settings.integrations.manage");
  const { t } = await getT(adminMessages);
  const s3 = any("STORAGE_ENDPOINT", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY");
  const cards = [
    { key: "database", ok: has("DATABASE_URL"), vars: ["DATABASE_URL", "DIRECT_URL"], note: t("adm.integ.databaseNote") },
    { key: "smtp", ok: emailConfigured(), vars: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"], note: t("adm.integ.smtpNote") },
    { key: "sms", ok: any("SMS_PROVIDER", "SMS_API_KEY", "TWILIO_ACCOUNT_SID"), vars: ["SMS_PROVIDER", "SMS_API_KEY"], note: t("adm.integ.smsNote") },
    { key: "payment", ok: any("PAYMENT_PROVIDER", "PAYMENT_API_KEY"), vars: ["PAYMENT_PROVIDER", "PAYMENT_API_KEY"], note: t("adm.integ.paymentNote") },
    { key: "webhook", ok: has("PAYMENT_WEBHOOK_SECRET"), vars: ["PAYMENT_WEBHOOK_SECRET"], note: t("adm.integ.webhookNote") },
    { key: "storage", ok: true, vars: ["STORAGE_ENDPOINT", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"], note: s3 ? t("adm.integ.storageS3") : t("adm.integ.storageDb") },
    { key: "cron", ok: has("CRON_SECRET"), vars: ["CRON_SECRET"], note: t("adm.integ.cronNote") },
  ];
  return (
    <>
      <PageHeader title={t("adm.integ.title")} description={t("adm.integ.subtitle")} />
      <div className="mb-6"><Alert tone="warn">{t("adm.integ.paymentWarning")}</Alert></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.key}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t(`adm.integ.${c.key}`)}</h2>
              {c.ok ? <Badge tone="green">{c.key === "storage" ? (s3 ? "S3" : t("adm.integ.dbStorage")) : t("adm.configured")}</Badge> : <Badge tone="slate">{t("adm.notConfigured")}</Badge>}
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{c.note}</p>
            <ul className="mt-3 flex flex-wrap gap-1">
              {c.vars.map((v) => (
                <li key={v} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800">
                  <span aria-hidden>{process.env[v] ? "●" : "○"}</span>{v}
                  <span className="sr-only">{process.env[v] ? t("adm.configured") : t("adm.notConfigured")}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
