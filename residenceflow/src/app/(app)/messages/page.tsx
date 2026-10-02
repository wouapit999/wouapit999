import Link from "next/link";
import { db } from "@/lib/db";
import { requireContext, tenantWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, EmptyState, FilterBar, Input, PageHeader, Select, Table, Td, Th, Tr, str } from "@/components/ui";
import { openThreadAction } from "./actions";
import { messageMessages } from "./i18n";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";
const MAX_THREADS = 100;

export default async function MessagesInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("message.view");
  const { t } = await getT(messageMessages);
  const settings = await getOrgSettings(ctx.organizationId);
  const df = { dateFormat: settings?.dateFormat ?? "dd/MM/yyyy", timezone: settings?.timezone ?? "Africa/Douala" };
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const unreadOnly = str(sp.unread) === "on";

  const tenantFilter = {
    ...tenantWhere(ctx),
    ...(q ? { OR: [{ legalName: { contains: q, mode: "insensitive" as const } }, { reference: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const baseWhere = { organizationId: ctx.organizationId, tenant: tenantFilter };
  const [threads, unread] = await Promise.all([
    db.message.groupBy({ by: ["tenantId"], where: baseWhere, _max: { createdAt: true }, _count: { _all: true }, orderBy: { _max: { createdAt: "desc" } }, take: 500 }),
    db.message.groupBy({ by: ["tenantId"], where: { ...baseWhere, fromTenant: true, readAt: null }, _count: { _all: true } }),
  ]);
  const unreadBy = new Map(unread.map((u) => [u.tenantId, u._count._all]));
  const visible = threads.filter((th) => !unreadOnly || (unreadBy.get(th.tenantId) ?? 0) > 0).slice(0, MAX_THREADS);
  const ids = visible.map((v) => v.tenantId);
  const [tenants, lastMessages, pickable] = await Promise.all([
    db.tenant.findMany({
      where: { id: { in: ids }, organizationId: ctx.organizationId },
      select: { id: true, legalName: true, reference: true, leases: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, select: { unit: { select: { number: true, property: { select: { name: true } } } } }, take: 1 } },
    }),
    // Latest message per thread (Postgres DISTINCT ON through Prisma's distinct).
    db.message.findMany({ where: { organizationId: ctx.organizationId, tenantId: { in: ids } }, orderBy: [{ tenantId: "asc" }, { createdAt: "desc" }], distinct: ["tenantId"], select: { tenantId: true, subject: true, body: true, fromTenant: true } }),
    db.tenant.findMany({ where: { ...tenantWhere(ctx), status: "ACTIVE" }, select: { id: true, legalName: true, reference: true }, orderBy: { legalName: "asc" }, take: 300 }),
  ]);
  const tenantBy = new Map(tenants.map((x) => [x.id, x]));
  const lastBy = new Map(lastMessages.map((m) => [m.tenantId, m]));
  const totalUnread = [...unreadBy.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title={t("msg.title")} description={t("msg.subtitle", { n: totalUnread })} />
      <div className="grid gap-6 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <FilterBar action="/messages">
            <Input label={t("common.search")} name="q" defaultValue={q} wrapperClassName="w-56" />
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="unread" defaultChecked={unreadOnly} className="h-4 w-4 accent-[var(--brand)]" />
              {t("msg.unreadOnly")}
            </label>
          </FilterBar>
          {visible.length === 0 ? (
            <EmptyState title={t("msg.none")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("common.tenant")}</Th>
                  <Th>{t("msg.last")}</Th>
                  <Th>{t("msg.when")}</Th>
                  <Th>{t("common.status")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((th) => {
                  const tenant = tenantBy.get(th.tenantId);
                  const last = lastBy.get(th.tenantId);
                  const n = unreadBy.get(th.tenantId) ?? 0;
                  const unit = tenant?.leases[0]?.unit;
                  return (
                    <Tr key={th.tenantId}>
                      <Td>
                        <Link href={`/messages/${th.tenantId}`} className="font-medium text-[var(--brand)] hover:underline">{tenant?.legalName ?? "—"}</Link>
                        <div className="text-xs text-slate-500">{tenant?.reference}{unit ? ` · ${unit.property.name} ${unit.number}` : ""}</div>
                      </Td>
                      <Td className="max-w-md">
                        <span className="text-xs text-slate-500">{last?.fromTenant ? t("msg.fromTenant") : t("msg.fromStaff")}: </span>
                        <span className="line-clamp-2 text-sm">{last?.subject ? <strong>{last.subject} — </strong> : null}{last?.body}</span>
                      </Td>
                      <Td className="whitespace-nowrap text-xs">{formatDateTime(th._max.createdAt, df)} · {th._count._all}</Td>
                      <Td>{n > 0 ? <Badge tone="amber">{t("msg.unreadN", { n })}</Badge> : <Badge tone="slate">{t("msg.read")}</Badge>}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>
        <Card title={t("msg.start")}>
          <ActionForm action={openThreadAction}>
            <Select label={t("common.tenant")} name="tenantId" required placeholder="" options={pickable.map((p) => ({ value: p.id, label: `${p.legalName} (${p.reference})` }))} />
            <SubmitButton variant="secondary">{t("msg.open")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
