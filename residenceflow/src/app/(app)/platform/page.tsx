import Link from "next/link";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/i18n";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { ResultForm } from "@/components/admin/result-form";
import { Badge, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th, Tr, Textarea, str } from "@/components/ui";
import { hasRecentReauth } from "@/services/reauth";
import { SUPPORT_DURATIONS, listSupportAccess, supportTargets } from "@/services/support-access";
import { platformMessages } from "./messages";
import { PlatformReauthCard, platformDict } from "./reauth-card";
import { createOrganizationAction, endSupportAccessNowAction, resetOrganizationAdminAction, setOrganizationStatusAction, startSupportAccessAction } from "./actions";

export const metadata = { title: "Platform" };

/** Platform super-admin console: organizations only — no tenant or financial data is queried. */
export default async function PlatformPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("platform.organizations.manage");
  const { t } = await getT(platformMessages);
  const sp = await searchParams;
  const selectedId = str(sp.org);
  const [orgs, reauthOk, sessions] = await Promise.all([
    db.organization.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, slug: true, status: true, createdAt: true, _count: { select: { users: true, properties: true } } },
    }),
    hasRecentReauth(ctx),
    listSupportAccess(100),
  ]);
  const selected = selectedId ? orgs.find((o) => o.id === selectedId) ?? null : null;
  const admins = selected ? await supportTargets(selected.id) : [];
  const fmt = { timezone: "UTC", dateFormat: "yyyy-MM-dd" };
  const dict = platformDict(t);
  const resultLabels = { link: t("plat.link"), emailSent: t("plat.emailSent"), emailNotSent: t("plat.emailNotSent"), once: t("plat.once"), copy: t("plat.copy"), copied: t("plat.copied") };

  return (
    <>
      <PageHeader title={t("plat.title")} description={t("plat.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {orgs.length === 0 ? (
            <EmptyState title={t("common.empty")} />
          ) : (
            <Table>
              <thead>
                <tr><Th>{t("common.name")}</Th><Th>{t("common.status")}</Th><Th>{t("plat.users")}</Th><Th>{t("plat.buildings")}</Th><Th>{t("plat.createdAt")}</Th><Th /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {orgs.map((o) => (
                  <Tr key={o.id}>
                    <Td><div className="font-medium">{o.name}</div><div className="font-mono text-xs text-slate-500">{o.slug}</div></Td>
                    <Td><Badge status={o.status}>{t(`plat.status.${o.status}`)}</Badge></Td>
                    <Td>{o._count.users}</Td>
                    <Td>{o._count.properties}</Td>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(o.createdAt, fmt)}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1">
                        <Link href={`/platform?org=${o.id}#manage`} className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">{t("plat.manage")}</Link>
                        {o.status !== "ACTIVE" && <InlineAction action={setOrganizationStatusAction} label={t("plat.activate")} hidden={{ id: o.id, status: "ACTIVE" }} />}
                        {o.status === "ACTIVE" && <InlineAction action={setOrganizationStatusAction} label={t("plat.suspend")} variant="danger" confirm={t("plat.suspendConfirm")} hidden={{ id: o.id, status: "SUSPENDED" }} />}
                        {o.status !== "ARCHIVED" && <InlineAction action={setOrganizationStatusAction} label={t("plat.archive")} confirm={t("plat.archiveConfirm")} hidden={{ id: o.id, status: "ARCHIVED" }} />}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        <Card title={t("plat.create")}>
          <ResultForm action={createOrganizationAction} dict={dict} resetOnSuccess labels={resultLabels}>
            <Input label={t("plat.orgName")} name="name" required maxLength={200} />
            <Input label={t("plat.slug")} name="slug" required maxLength={50} hint={t("plat.slugHint")} />
            <Input label={t("plat.adminName")} name="adminName" required maxLength={120} />
            <Input label={t("plat.adminEmail")} name="adminEmail" type="email" required maxLength={200} />
            <p className="text-xs text-slate-500">{t("plat.createHint")}</p>
            <SubmitButton>{t("common.create")}</SubmitButton>
          </ResultForm>
        </Card>
      </div>

      {selected && (
        <section id="manage" className="mt-8 space-y-6">
          <h2 className="text-lg font-semibold">{selected.name}</h2>
          <PlatformReauthCard ok={reauthOk} t={t} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t("sup.title")}>
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("sup.subtitle")}</p>
              {admins.length === 0 ? (
                <p className="text-sm text-slate-500">{t("plat.noAdmins")}</p>
              ) : (
                <ActionForm action={startSupportAccessAction} dict={dict} confirm={t("sup.startConfirm")}>
                  <input type="hidden" name="organizationId" value={selected.id} />
                  <Select label={t("sup.target")} name="targetUserId" required options={admins.map((a) => ({ value: a.id, label: `${a.name} — ${a.email}` }))} />
                  <Textarea label={t("sup.reason")} name="reason" required minLength={10} maxLength={1000} />
                  <Input label={t("sup.ticketRef")} name="ticketRef" maxLength={100} />
                  <Select label={t("sup.duration")} name="durationMinutes" defaultValue="15" options={SUPPORT_DURATIONS.map((d) => ({ value: String(d), label: t("sup.minutes", { n: d }) }))} />
                  <SubmitButton disabled={!reauthOk || selected.status !== "ACTIVE"}>{t("sup.start")}</SubmitButton>
                </ActionForm>
              )}
            </Card>
            <Card title={t("plat.resetAdmin")}>
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("plat.resetAdminHint")}</p>
              {admins.length === 0 ? (
                <p className="text-sm text-slate-500">{t("plat.noAdmins")}</p>
              ) : (
                <ResultForm action={resetOrganizationAdminAction} dict={dict} labels={{ ...resultLabels, link: t("plat.resetLink") }}>
                  <input type="hidden" name="organizationId" value={selected.id} />
                  <Select label={t("plat.admins")} name="userId" required options={admins.map((a) => ({ value: a.id, label: `${a.name} — ${a.email}` }))} />
                  <SubmitButton variant="secondary" disabled={!reauthOk}>{t("plat.sendReset")}</SubmitButton>
                </ResultForm>
              )}
            </Card>
          </div>
        </section>
      )}

      <section className="mt-8">
        <Card title={t("sup.history")}>
          {sessions.length === 0 ? (
            <p className="text-sm text-slate-500">{t("sup.noHistory")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("sup.org")}</Th><Th>{t("sup.platformUser")}</Th><Th>{t("sup.targetUser")}</Th><Th>{t("sup.reason")}</Th><Th>{t("sup.started")}</Th><Th>{t("sup.endsAt")}</Th><Th>{t("common.status")}</Th><Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sessions.map((s) => (
                  <Tr key={s.id}>
                    <Td>{s.organization?.name ?? "—"}</Td>
                    <Td>{s.platformUser?.name ?? "—"}</Td>
                    <Td>{s.targetUser?.name ?? "—"}</Td>
                    <Td className="max-w-xs text-xs">{s.reason}{s.ticketRef ? <span className="ml-1 font-mono text-slate-500">[{s.ticketRef}]</span> : null}</Td>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(s.startedAt, fmt)}</Td>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(s.endedAt ?? s.expiresAt, fmt)}</Td>
                    <Td><Badge tone={s.active ? "amber" : "slate"}>{s.active ? t("sup.active") : s.endedAt ? t("sup.closed") : t("sup.expired")}</Badge></Td>
                    <Td>{s.active && <InlineAction action={endSupportAccessNowAction} label={t("sup.endNow")} variant="danger" confirm={t("sup.endConfirm")} hidden={{ id: s.id }} />}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </section>
    </>
  );
}
