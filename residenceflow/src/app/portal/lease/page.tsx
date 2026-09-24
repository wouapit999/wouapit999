import { db } from "@/lib/db";
import { formatDay, formatMoney } from "@/lib/format";
import { money, sum } from "@/lib/money";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Badge, Card, DescriptionList, EmptyState, Input, PageHeader, Textarea } from "@/components/ui";
import { currentLease, dayIso, todayUtcDay } from "@/services/portal";
import { noticeToVacateAction } from "../actions";
import { OccupantNotice, PORTAL_ERROR_KEYS, dictFor, portalPage } from "../kit";

export const metadata = { title: "My lease" };
export const dynamic = "force-dynamic";

export default async function PortalLeasePage() {
  const { ctx, tenantId, t, fmt, df, occupant } = await portalPage();
  if (occupant) return <OccupantNotice t={t} title={t("nav.portal.lease")} />;
  const org = ctx.organizationId;
  const lease = await currentLease(org, tenantId);
  if (!lease) {
    return (
      <>
        <PageHeader title={t("nav.portal.lease")} />
        <EmptyState title={t("portal.lease.none")} description={t("portal.lease.noneHint")} />
      </>
    );
  }
  const [contacts, documents] = await Promise.all([
    db.tenantContact.findMany({ where: { tenantId, tenant: { organizationId: org }, kind: { in: ["CO_TENANT", "OCCUPANT", "DEPENDANT"] } }, orderBy: { name: "asc" } }),
    db.document.findMany({
      where: { organizationId: org, tenantId, visibleToTenant: true, sensitive: false, OR: [{ leaseId: lease.id }, { category: "LEASE" }] },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, category: true, createdAt: true, version: true },
    }),
  ]);
  const depositTx = lease.deposit?.transactions.filter((x) => x.status === "APPROVED") ?? [];
  const depositHeld = sum(depositTx.filter((x) => x.type === "RECEIPT").map((x) => x.amount))
    .minus(sum(depositTx.filter((x) => x.type !== "RECEIPT").map((x) => x.amount)));
  const minDate = dayIso(todayUtcDay());
  const recommended = dayIso(new Date(todayUtcDay().getTime() + lease.noticeDays * 86_400_000));

  return (
    <>
      <PageHeader title={t("nav.portal.lease")} description={`${lease.reference} · ${lease.unit.property.name} · ${t("common.unit")} ${lease.unit.number}`} />
      {lease.status === "NOTICE_GIVEN" && (
        <div className="mb-4">
          <Alert tone="warn">{t("portal.lease.noticeRecorded", { date: formatDay(lease.moveOutDate ?? lease.endDate, df) })}</Alert>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={t("portal.lease.summary")}>
          <DescriptionList
            items={[
              { label: t("common.status"), value: <Badge status={lease.status}>{t(`portal.leaseStatus.${lease.status}`)}</Badge> },
              { label: t("common.building"), value: [lease.unit.property.name, lease.unit.property.address, lease.unit.property.city].filter(Boolean).join(", ") },
              { label: t("common.unit"), value: `${lease.unit.block ? `${lease.unit.block} · ` : ""}${lease.unit.number} (${t("portal.lease.floor")} ${lease.unit.floor})` },
              { label: t("portal.lease.start"), value: formatDay(lease.startDate, df) },
              { label: t("portal.lease.end"), value: formatDay(lease.endDate, df) },
              { label: t("portal.lease.moveIn"), value: formatDay(lease.moveInDate, df) },
              { label: t("portal.lease.rent"), value: `${formatMoney(lease.rentAmount, { ...fmt, currency: lease.currency })} / ${t(`portal.freq.${lease.frequency}`)}` },
              { label: t("portal.lease.charges"), value: formatMoney(lease.serviceCharge, { ...fmt, currency: lease.currency }) },
              { label: t("portal.lease.dueDay"), value: t("portal.lease.dueDayValue", { day: lease.dueDay, grace: lease.graceDays }) },
              { label: t("portal.lease.deposit"), value: `${formatMoney(lease.depositAmount, { ...fmt, currency: lease.currency })}${lease.deposit ? ` · ${t("portal.lease.depositHeld", { amount: formatMoney(money(depositHeld), { ...fmt, currency: lease.currency }) })}` : ""}` },
              { label: t("portal.lease.notice"), value: t("portal.lease.noticeDays", { n: lease.noticeDays }) },
            ]}
          />
          {lease.specialTerms && (
            <div className="mt-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("portal.lease.terms")}</h3>
              <p className="mt-1 whitespace-pre-line text-sm">{lease.specialTerms}</p>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title={t("portal.lease.household")}>
            {contacts.length === 0 ? (
              <p className="text-sm text-slate-500">{t("common.none")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span>{c.name}{c.relationship ? <span className="text-xs text-slate-500"> · {c.relationship}</span> : null}</span>
                    <Badge tone="slate">{t(`portal.contact.${c.kind}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t("portal.lease.documents")}>
            {documents.length === 0 ? (
              <p className="text-sm text-slate-500">{t("portal.docs.none")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <a className="min-w-0 truncate text-[var(--brand)] hover:underline" href={`/api/documents/${d.id}`}>{d.name}</a>
                    <span className="shrink-0 text-xs text-slate-500">v{d.version} · {formatDay(d.createdAt, df)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {lease.status === "ACTIVE" && (
        <Card className="mt-4" title={t("portal.lease.giveNotice")}>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("portal.lease.giveNoticeHint", { n: lease.noticeDays, date: formatDay(new Date(recommended), df) })}</p>
          <ActionForm action={noticeToVacateAction} resetOnSuccess dict={dictFor(t, PORTAL_ERROR_KEYS)} confirm={t("portal.lease.noticeConfirm")} className="max-w-lg">
            <Input label={t("portal.lease.desiredDate")} name="desiredDate" type="date" min={minDate} defaultValue={recommended} required />
            <Textarea label={t("portal.lease.noticeReason")} name="reason" maxLength={2000} />
            <SubmitButton variant="secondary">{t("portal.lease.sendNotice")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
