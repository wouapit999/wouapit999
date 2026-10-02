import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, EmptyState, FilterBar, Input, PageHeader, Pagination, Select, Textarea, parsePage, str } from "@/components/ui";
import { createAnnouncementAction, expireAnnouncementAction, togglePinAction } from "./actions";
import { announcementMessages } from "./i18n";

export const metadata = { title: "Announcements" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;
const AUDIENCES = ["ALL", "TENANTS", "STAFF"];

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("announcement.view");
  const { t } = await getT(announcementMessages);
  const settings = await getOrgSettings(ctx.organizationId);
  const df = { dateFormat: settings?.dateFormat ?? "dd/MM/yyyy", timezone: settings?.timezone ?? "Africa/Douala" };
  const sp = await searchParams;
  const state = str(sp.state) || "active";
  const audience = str(sp.audience);
  const propertyId = str(sp.propertyId);
  const page = parsePage(sp.page);
  const now = new Date();
  const manage = can(ctx, "announcement.manage");

  const properties = await db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const scopeFilter: Prisma.AnnouncementWhereInput =
    ctx.propertyIds === "ALL" ? {} : { OR: [{ propertyId: null }, { propertyId: { in: ctx.propertyIds } }] };
  const where: Prisma.AnnouncementWhereInput = {
    organizationId: ctx.organizationId,
    AND: [
      scopeFilter,
      state === "expired" ? { expiresAt: { lte: now } } : state === "active" ? { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } : {},
      audience ? { audience } : {},
      propertyId === "org" ? { propertyId: null } : propertyId ? { propertyId } : {},
    ],
  };
  const [total, rows] = await Promise.all([
    db.announcement.count({ where }),
    db.announcement.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { property: { select: { name: true } } },
    }),
  ]);
  const dict = Object.fromEntries(["ann.published", "ann.expiredMsg", "ann.err.buildingRequired", "ann.err.expiryPast"].map((k) => [k, t(k)]));
  const buildingOptions = [
    ...(ctx.propertyIds === "ALL" ? [{ value: "", label: t("ann.orgWide") }] : []),
    ...properties.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <>
      <PageHeader title={t("ann.title")} description={t("ann.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FilterBar action="/announcements">
            <Select label={t("common.status")} name="state" defaultValue={state} options={["active", "expired", "all"].map((v) => ({ value: v, label: t(`ann.state.${v}`) }))} wrapperClassName="w-36" />
            <Select label={t("ann.audience")} name="audience" defaultValue={audience} placeholder={t("common.all")} options={AUDIENCES.map((a) => ({ value: a, label: t(`ann.aud.${a}`) }))} wrapperClassName="w-40" />
            <Select label={t("common.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={[{ value: "org", label: t("ann.orgWide") }, ...properties.map((p) => ({ value: p.id, label: p.name }))]} wrapperClassName="w-48" />
          </FilterBar>
          {rows.length === 0 ? (
            <EmptyState title={t("ann.none")} />
          ) : (
            <ul className="space-y-3">
              {rows.map((a) => {
                const expired = !!a.expiresAt && a.expiresAt <= now;
                return (
                  <li key={a.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="font-semibold text-slate-900 dark:text-white">{a.title}</h2>
                          <p className="text-xs text-slate-500">
                            {formatDateTime(a.publishedAt, df)} · {a.property?.name ?? t("ann.orgWide")}
                            {a.expiresAt ? ` · ${t("ann.expires")} ${formatDateTime(a.expiresAt, df)}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {a.pinned && <Badge tone="violet">{t("ann.pinned")}</Badge>}
                          <Badge tone="blue">{t(`ann.aud.${a.audience}`)}</Badge>
                          {expired ? <Badge status="EXPIRED">{t("ann.state.expired")}</Badge> : <Badge status="ACTIVE">{t("ann.state.active")}</Badge>}
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{a.body}</p>
                      {manage && !expired && (a.propertyId ? ctx.propertyIds === "ALL" || ctx.propertyIds.includes(a.propertyId) : ctx.propertyIds === "ALL") && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <InlineAction action={togglePinAction} label={a.pinned ? t("ann.unpin") : t("ann.pin")} hidden={{ id: a.id }} />
                          <InlineAction action={expireAnnouncementAction} label={t("ann.expireNow")} variant="danger" confirm={t("ann.expireConfirm")} hidden={{ id: a.id }} />
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/announcements" params={{ state, audience, propertyId }} />
        </div>
        {manage && (
          <Card title={t("ann.new")}>
            <ActionForm action={createAnnouncementAction} resetOnSuccess dict={dict}>
              <Input label={t("ann.fTitle")} name="title" required minLength={3} maxLength={150} />
              <Textarea label={t("ann.fBody")} name="body" required minLength={3} maxLength={5000} rows={5} />
              <Select label={t("ann.audience")} name="audience" defaultValue="ALL" options={AUDIENCES.map((a) => ({ value: a, label: t(`ann.aud.${a}`) }))} />
              <Select label={t("common.building")} name="propertyId" required={ctx.propertyIds !== "ALL"} options={buildingOptions} />
              <Input label={t("ann.fExpires")} name="expiresAt" type="date" hint={t("ann.fExpiresHint")} />
              <Checkbox label={t("ann.fPinned")} name="pinned" />
              <Checkbox label={t("ann.fNotify")} name="notify" defaultChecked />
              <SubmitButton>{t("ann.publish")}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
