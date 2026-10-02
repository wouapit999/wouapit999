import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Input, PageHeader, Pagination, Stat, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { hasRecentReauth } from "@/services/reauth";
import { adminDict, adminMessages } from "../messages";
import { ReauthCard } from "../reauth-card";
import { saveSecuritySettingsAction } from "./actions";

export const metadata = { title: "Security" };
const PAGE_SIZE = 30;

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("settings.security.manage");
  const { t } = await getT(adminMessages);
  const s = await getOrgSettings(ctx.organizationId);
  if (!s) notFound();
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const outcome = str(sp.outcome);
  const fmt = { timezone: s.timezone, dateFormat: s.dateFormat };
  const orgUsers = await db.user.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true, email: true, failedLoginCount: true, lockedUntil: true } });
  const ids = orgUsers.map((u) => u.id);
  const byId = new Map(orgUsers.map((u) => [u.id, u]));
  const since = new Date(Date.now() - 24 * 3600_000);
  const where = { userId: { in: ids }, ...(outcome === "failure" ? { success: false } : outcome === "success" ? { success: true } : {}) };
  const [reauthOk, total, attempts, failed24, success24] = await Promise.all([
    hasRecentReauth(ctx),
    db.loginAttempt.count({ where }),
    db.loginAttempt.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.loginAttempt.count({ where: { userId: { in: ids }, success: false, createdAt: { gte: since } } }),
    db.loginAttempt.count({ where: { userId: { in: ids }, success: true, createdAt: { gte: since } } }),
  ]);
  const now = new Date();
  const locked = orgUsers.filter((u) => u.lockedUntil && u.lockedUntil > now);
  const withFailures = orgUsers.filter((u) => u.failedLoginCount > 0).sort((a, b) => b.failedLoginCount - a.failedLoginCount).slice(0, 10);

  return (
    <>
      <PageHeader title={t("adm.security.title")} description={t("adm.security.subtitle")} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label={t("adm.security.failed24")} value={failed24} tone={failed24 > 20 ? "bad" : failed24 > 0 ? "warn" : "default"} />
        <Stat label={t("adm.security.success24")} value={success24} tone="good" />
        <Stat label={t("adm.security.lockedNow")} value={locked.length} tone={locked.length ? "bad" : "default"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <ReauthCard ok={reauthOk} t={t} />
          <Card title={t("adm.security.policy")}>
            <ActionForm action={saveSecuritySettingsAction} dict={adminDict(t)}>
              <Input label={t("adm.security.sessionTimeout")} name="sessionTimeoutMinutes" type="number" min={5} max={43200} defaultValue={s.sessionTimeoutMinutes} />
              <Input label={t("adm.security.minLength")} name="passwordMinLength" type="number" min={10} max={64} defaultValue={s.passwordMinLength} />
              <Input label={t("adm.security.maxAttempts")} name="maxLoginAttempts" type="number" min={3} max={20} defaultValue={s.maxLoginAttempts} />
              <Input label={t("adm.security.lockout")} name="lockoutMinutes" type="number" min={1} max={1440} defaultValue={s.lockoutMinutes} />
              <Input label={t("adm.security.history")} name="passwordHistoryCount" type="number" min={0} max={24} defaultValue={s.passwordHistoryCount} />
              <SubmitButton>{t("common.save")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card title={t("adm.security.failedByUser")}>
            {withFailures.length === 0 ? (
              <p className="text-sm text-slate-500">{t("common.none")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {withFailures.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2">
                    <Link className="truncate text-[var(--brand)] hover:underline" href={`/admin/users/${u.id}`}>{u.name}</Link>
                    <span className="flex items-center gap-1">
                      {u.lockedUntil && u.lockedUntil > now && <Badge tone="red">{t("adm.users.locked")}</Badge>}
                      <Badge tone="amber">{u.failedLoginCount}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card title={t("adm.security.attempts")} actions={
            <div className="flex gap-2 text-xs">
              {["", "failure", "success"].map((o) => (
                <Link key={o} href={o ? `/admin/security?outcome=${o}` : "/admin/security"} className={outcome === o ? "font-semibold text-[var(--brand)]" : "text-slate-500 hover:underline"}>
                  {o ? t(`adm.security.${o}`) : t("common.all")}
                </Link>
              ))}
            </div>
          }>
            <Table>
              <thead><tr><Th>{t("common.date")}</Th><Th>{t("adm.security.identifier")}</Th><Th>IP</Th><Th>{t("adm.security.outcome")}</Th><Th>{t("common.reason")}</Th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {attempts.map((a) => {
                  const u = a.userId ? byId.get(a.userId) : undefined;
                  return (
                    <Tr key={a.id}>
                      <Td className="whitespace-nowrap text-xs">{formatDateTime(a.createdAt, fmt)}</Td>
                      <Td className="text-xs">{u ? <Link className="text-[var(--brand)] hover:underline" href={`/admin/users/${u.id}`}>{a.identifier}</Link> : a.identifier}</Td>
                      <Td className="font-mono text-xs">{a.ip ?? "—"}</Td>
                      <Td>{a.success ? <Badge tone="green">{t("adm.security.success")}</Badge> : <Badge tone="red">{t("adm.security.failure")}</Badge>}</Td>
                      <Td className="text-xs">{a.reason ?? ""}</Td>
                    </Tr>
                  );
                })}
                {attempts.length === 0 && <Tr><Td colSpan={5} className="text-center text-slate-500">{t("common.empty")}</Td></Tr>}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/security" params={{ outcome }} />
          </Card>
        </div>
      </div>
    </>
  );
}
