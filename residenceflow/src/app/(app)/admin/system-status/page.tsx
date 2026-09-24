import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { hasAnyPermission } from "@/lib/permissions";
import { emailConfigured } from "@/lib/notify/email";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/i18n";
import { Badge, Card, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { adminMessages } from "../messages";

export const metadata = { title: "System status" };
export const dynamic = "force-dynamic";

async function dbCheck() {
  const start = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - start) };
  }
}

export default async function SystemStatusPage() {
  const ctx = await requireContext();
  if (!hasAnyPermission(ctx.permissions, ["system.status.view", "settings.general.manage"])) redirect("/unauthorized");
  const { t } = await getT(adminMessages);
  const settings = ctx.organizationId ? await getOrgSettings(ctx.organizationId) : null;
  const fmt = { timezone: settings?.timezone ?? "UTC", dateFormat: settings?.dateFormat };
  const check = await dbCheck();
  const orgFilter = ctx.organizationId ? { organizationId: ctx.organizationId } : {};
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [jobs, failedNotifs, queuedNotifs] = check.ok
    ? await Promise.all([
        db.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 10, select: { id: true, jobKey: true, startedAt: true, finishedAt: true, status: true } }),
        db.notification.count({ where: { ...orgFilter, deliveryStatus: "FAILED", createdAt: { gte: since } } }),
        db.notification.count({ where: { ...orgFilter, deliveryStatus: "QUEUED" } }),
      ])
    : [[], 0, 0];
  const s3 = Boolean(process.env.STORAGE_ENDPOINT || process.env.STORAGE_BUCKET);
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const email = emailConfigured();

  return (
    <>
      <PageHeader title={t("adm.sys.title")} description={t("adm.sys.subtitle")} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("adm.sys.database")} value={check.ok ? `${check.ms} ms` : t("adm.sys.down")} tone={check.ok ? (check.ms > 500 ? "warn" : "good") : "bad"} hint={check.ok ? t("adm.sys.dbOk") : t("adm.sys.dbDown")} />
        <Stat label={t("adm.sys.failedNotifs")} value={failedNotifs} tone={failedNotifs ? "warn" : "default"} hint={t("adm.sys.last7")} />
        <Stat label={t("adm.sys.queuedNotifs")} value={queuedNotifs} />
        <Stat label={t("adm.sys.version")} value={<span className="font-mono text-base">{sha ? sha.slice(0, 7) : "dev"}</span>} hint={process.env.VERCEL_ENV ?? process.env.NODE_ENV} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t("adm.sys.services")}>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between gap-2">{t("adm.integ.smtp")} {email ? <Badge tone="green">{t("adm.configured")}</Badge> : <Badge>{t("adm.notConfigured")}</Badge>}</li>
            <li className="flex items-center justify-between gap-2">{t("adm.integ.storage")} <Badge tone="blue">{s3 ? "S3" : t("adm.integ.dbStorage")}</Badge></li>
            <li className="flex items-center justify-between gap-2">{t("adm.integ.cron")} {process.env.CRON_SECRET ? <Badge tone="green">{t("adm.configured")}</Badge> : <Badge tone="amber">{t("adm.notConfigured")}</Badge>}</li>
          </ul>
        </Card>
        <Card title={t("adm.sys.jobs")} className="lg:col-span-2">
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-500">{t("adm.sys.noJobs")}</p>
          ) : (
            <Table>
              <thead><tr><Th>{t("adm.sys.job")}</Th><Th>{t("adm.sys.started")}</Th><Th>{t("adm.sys.finished")}</Th><Th>{t("common.status")}</Th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {jobs.map((j) => (
                  <Tr key={j.id}>
                    <Td className="font-mono text-xs">{j.jobKey}</Td>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(j.startedAt, fmt)}</Td>
                    <Td className="whitespace-nowrap text-xs">{j.finishedAt ? formatDateTime(j.finishedAt, fmt) : "—"}</Td>
                    <Td><Badge tone={j.status === "SUCCESS" || j.status === "COMPLETED" ? "green" : j.status === "RUNNING" ? "blue" : "red"}>{j.status}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
