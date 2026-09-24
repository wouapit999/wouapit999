import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, leaseWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { canAccessDocument } from "@/lib/storage";
import { formatDate, formatDateTime, formatDay, formatMoney } from "@/lib/format";
import { money, sum } from "@/lib/money";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, DescriptionList, Input, LinkButton, PageHeader, Table, Td, Textarea, Th, Tr, humanize } from "@/components/ui";
import { tenantMessages } from "../../tenants/messages";
import {
  approveLeaseAction,
  createRenewalAction,
  recordNoticeAction,
  returnToDraftAction,
  submitLeaseAction,
  terminateLeaseAction,
  uploadLeaseDocumentAction,
} from "../actions";
import { unitLabel } from "../data";
import { dayInput, todayUtcDay } from "../fields";
import { leaseMessages } from "../messages";

export const metadata = { title: "Lease" };

export default async function LeaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("lease.view");
  const { t, locale } = await getT(leaseMessages, tenantMessages);
  const lease = await db.lease.findFirst({
    where: { ...leaseWhere(ctx), id },
    include: {
      tenant: { include: { contacts: { orderBy: { kind: "asc" } } } },
      unit: { include: { property: { select: { id: true, name: true } } } },
      events: { orderBy: { createdAt: "desc" } },
      schedules: { orderBy: [{ periodStart: "asc" }, { chargeType: "asc" }], include: { invoice: { select: { id: true, number: true, status: true } } } },
      deposit: { include: { transactions: { where: { status: "APPROVED" } } } },
    },
  });
  if (!lease) notFound();

  const perms = {
    tenant: can(ctx, "tenant.view"),
    create: can(ctx, "lease.create"),
    approve: can(ctx, "lease.approve") || can(ctx, "lease.activate"),
    terminate: can(ctx, "lease.terminate"),
    invoices: can(ctx, "invoice.view"),
    docs: can(ctx, "document.view"),
    upload: can(ctx, "document.upload"),
  };

  const [previous, renewals, documents, settings] = await Promise.all([
    lease.previousLeaseId
      ? db.lease.findFirst({ where: { ...leaseWhere(ctx), id: lease.previousLeaseId }, select: { id: true, reference: true, status: true } })
      : Promise.resolve(null),
    db.lease.findMany({ where: { ...leaseWhere(ctx), previousLeaseId: lease.id }, select: { id: true, reference: true, status: true }, orderBy: { createdAt: "asc" } }),
    perms.docs
      ? db.document.findMany({
          where: { organizationId: ctx.organizationId, leaseId: lease.id },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true, name: true, category: true, size: true, createdAt: true,
            organizationId: true, tenantId: true, propertyId: true, leaseId: true, workOrderId: true,
            visibleToTenant: true, sensitive: true, uploadedById: true,
          },
        })
      : Promise.resolve([]),
    getOrgSettings(ctx.organizationId),
  ]);
  const visibleDocs = (await Promise.all(documents.map(async (d) => ((await canAccessDocument(ctx, d)) ? d : null)))).filter((d) => d !== null);

  const actorIds = [...new Set([lease.approvedById, ...lease.events.map((e) => e.actorId)].filter((x): x is string => !!x))];
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds }, organizationId: ctx.organizationId }, select: { id: true, name: true } }) : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  const fmt = { locale, currency: lease.currency || settings?.currency || "XAF" };
  const dfmt = { timezone: settings?.timezone ?? "Africa/Douala", dateFormat: settings?.dateFormat ?? "dd/MM/yyyy" };
  const fixDict = { "Please correct the highlighted fields.": t("lease.fixFields") };
  const label = unitLabel(lease.unit);
  const s = lease.status;
  const eventLabel = (type: string) => {
    const k = `lease.event.${type}`;
    const v = t(k);
    return v === k ? humanize(type) : v;
  };

  // Deposit summary (approved transactions only).
  const tx = lease.deposit?.transactions ?? [];
  const received = sum(tx.filter((x) => x.type === "RECEIPT").map((x) => x.amount));
  const deducted = sum(tx.filter((x) => x.type === "DEDUCTION").map((x) => x.amount));
  const refunded = sum(tx.filter((x) => x.type === "REFUND").map((x) => x.amount));
  const held = received.minus(deducted).minus(refunded);

  // Renewal defaults: day after current end, same length of one year, current rent.
  const renewalStart = new Date(lease.endDate.getTime() + 86_400_000);
  const renewalEnd = new Date(Date.UTC(renewalStart.getUTCFullYear() + 1, renewalStart.getUTCMonth(), renewalStart.getUTCDate() - 1));
  const today = todayUtcDay();

  const canSubmit = s === "DRAFT" && perms.create;
  const canApprove = s === "PENDING_APPROVAL" && perms.approve;
  const canNotice = s === "ACTIVE" && perms.terminate;
  const canTerminate = (s === "ACTIVE" || s === "NOTICE_GIVEN") && perms.terminate;
  const canRenew = (s === "ACTIVE" || s === "NOTICE_GIVEN" || s === "EXPIRED") && perms.create;
  const anyAction = canSubmit || canApprove || canNotice || canTerminate || canRenew;

  return (
    <>
      <PageHeader
        title={`${t("lease.title")} ${lease.reference}`}
        description={`${perms.tenant ? `${lease.tenant.legalName} · ` : ""}${label}`}
        breadcrumbs={[{ label: t("lease.title"), href: "/leases" }, { label: lease.reference }]}
        actions={
          <>
            <Badge status={s}>{t(`lease.status.${s}`)}</Badge>
            {s === "DRAFT" && perms.create && <LinkButton variant="secondary" href={`/leases/${lease.id}/edit`}>{t("common.edit")}</LinkButton>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("lease.summary")}>
            <DescriptionList
              items={[
                { label: t("lease.status"), value: <Badge status={s}>{t(`lease.status.${s}`)}</Badge> },
                { label: t("lease.unit"), value: <Link className="hover:underline" href={`/units/${lease.unit.id}`}>{label}</Link> },
                { label: t("lease.dates"), value: `${formatDay(lease.startDate, dfmt)} → ${formatDay(lease.endDate, dfmt)}` },
                { label: t("lease.moveInDate"), value: lease.moveInDate ? formatDay(lease.moveInDate, dfmt) : null },
                { label: t("lease.rent"), value: `${formatMoney(lease.rentAmount, fmt)} · ${t(`lease.freq.${lease.frequency}`)}` },
                { label: t("lease.serviceCharge"), value: formatMoney(lease.serviceCharge, fmt) },
                { label: t("lease.deposit"), value: formatMoney(lease.depositAmount, fmt) },
                { label: t("lease.dueDay"), value: String(lease.dueDay) },
                { label: t("lease.graceDays"), value: String(lease.graceDays) },
                {
                  label: t("lease.lateFeeType"),
                  value: lease.lateFeeType === "NONE" ? t("lease.lateFee.NONE") : lease.lateFeeType === "PERCENT" ? `${lease.lateFeeValue.toString()} %` : formatMoney(lease.lateFeeValue, fmt),
                },
                { label: t("lease.noticeDays"), value: String(lease.noticeDays) },
                { label: t("lease.prorate"), value: lease.prorate ? "✓" : "—" },
                { label: t("lease.version"), value: String(lease.version) },
                { label: t("lease.previousVersion"), value: previous ? <Link className="text-[var(--brand)] hover:underline" href={`/leases/${previous.id}`}>{previous.reference}</Link> : null },
                {
                  label: t("lease.renewals"),
                  value: renewals.length ? (
                    <span className="flex flex-wrap gap-2">
                      {renewals.map((r) => (
                        <Link key={r.id} className="text-[var(--brand)] hover:underline" href={`/leases/${r.id}`}>{r.reference} ({t(`lease.status.${r.status}`)})</Link>
                      ))}
                    </span>
                  ) : null,
                },
                { label: t("lease.approvedAt"), value: lease.approvedAt ? `${formatDateTime(lease.approvedAt, dfmt)}${lease.approvedById && actorName.get(lease.approvedById) ? ` · ${t("lease.by", { name: actorName.get(lease.approvedById)! })}` : ""}` : null },
                { label: t("lease.noticeDate"), value: lease.noticeDate ? formatDate(lease.noticeDate, dfmt) : null },
                { label: t("lease.moveOutDate"), value: lease.moveOutDate ? formatDay(lease.moveOutDate, dfmt) : null },
                { label: t("lease.terminatedAt"), value: lease.terminatedAt ? formatDate(lease.terminatedAt, dfmt) : null },
                { label: t("lease.terminationReason"), value: lease.terminationReason },
              ]}
            />
            {lease.specialTerms && (
              <div className="mt-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("lease.specialTerms")}</h3>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{lease.specialTerms}</p>
              </div>
            )}
            {lease.renewalTerms && (
              <div className="mt-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("lease.renewalTerms")}</h3>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{lease.renewalTerms}</p>
              </div>
            )}
          </Card>

          {perms.tenant && (
            <Card title={t("lease.parties")}>
              <p className="text-sm">
                <Link className="font-medium text-[var(--brand)] hover:underline" href={`/tenants/${lease.tenant.id}`}>{lease.tenant.legalName}</Link>
                <span className="text-slate-500"> · {lease.tenant.reference}</span>
              </p>
              <p className="text-xs text-slate-500">{[lease.tenant.phone, lease.tenant.email].filter(Boolean).join(" · ")}</p>
              {lease.tenant.contacts.length > 0 && (
                <>
                  <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">{t("lease.contacts")}</h3>
                  <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    {lease.tenant.contacts.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                        <Badge tone="slate">{t(`tenant.contact.kind.${c.kind}`)}</Badge>
                        <span>{c.name}</span>
                        <span className="text-xs text-slate-500">{[c.relationship, c.phone, c.email].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}

          <Card title={t("lease.schedule")}>
            {lease.schedules.length === 0 ? (
              <p className="text-sm text-slate-500">{t("lease.schedule.empty")}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("lease.period")}</Th>
                    <Th>{t("lease.chargeType")}</Th>
                    <Th>{t("lease.dueDate")}</Th>
                    <Th className="text-right">{t("lease.amount")}</Th>
                    <Th>{t("lease.invoice")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lease.schedules.map((r) => (
                    <Tr key={r.id}>
                      <Td className={`whitespace-nowrap ${r.cancelled ? "text-slate-400 line-through" : ""}`}>{formatDay(r.periodStart, dfmt)} → {formatDay(r.periodEnd, dfmt)}</Td>
                      <Td>{humanize(r.chargeType)}</Td>
                      <Td className="whitespace-nowrap">{formatDay(r.dueDate, dfmt)}</Td>
                      <Td className="whitespace-nowrap text-right">{formatMoney(r.amount, fmt)}</Td>
                      <Td>
                        {r.cancelled ? (
                          <Badge status="CANCELLED">{t("lease.cancelled")}</Badge>
                        ) : r.invoice ? (
                          <span className="flex flex-wrap items-center gap-1">
                            {perms.invoices ? <Link className="font-mono text-xs text-[var(--brand)] hover:underline" href={`/invoices/${r.invoice.id}`}>{r.invoice.number}</Link> : <span className="font-mono text-xs">{r.invoice.number}</span>}
                            <Badge status={r.invoice.status} />
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">{t("lease.notInvoiced")}</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title={t("lease.timeline")}>
            {lease.events.length === 0 ? (
              <p className="text-sm text-slate-500">{t("common.none")}</p>
            ) : (
              <ol className="space-y-3">
                {lease.events.map((e) => (
                  <li key={e.id} className="border-l-2 border-slate-200 pl-3 text-sm dark:border-slate-700">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{eventLabel(e.type)}</div>
                    {e.note && <p className="whitespace-pre-line text-slate-700 dark:text-slate-300">{e.note}</p>}
                    <p className="text-xs text-slate-500">
                      {formatDateTime(e.createdAt, dfmt)}
                      {e.actorId && actorName.get(e.actorId) ? ` · ${actorName.get(e.actorId)}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={t("lease.workflow")}>
            {!anyAction && <p className="text-sm text-slate-500">{t("lease.noActions")}</p>}
            <div className="space-y-5">
              {canSubmit && (
                <InlineAction action={submitLeaseAction} label={t("lease.submit")} variant="primary" hidden={{ id: lease.id }} />
              )}
              {canApprove && (
                <>
                  <InlineAction action={approveLeaseAction} label={t("lease.approve")} variant="primary" confirm={t("lease.approveConfirm")} hidden={{ id: lease.id }} />
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-[var(--brand)]">{t("lease.returnDraft")}</summary>
                    <ActionForm action={returnToDraftAction} className="mt-3" dict={fixDict}>
                      <input type="hidden" name="id" value={lease.id} />
                      <Textarea label={t("lease.reason")} name="reason" required minLength={3} maxLength={1000} />
                      <SubmitButton variant="secondary">{t("lease.returnDraft")}</SubmitButton>
                    </ActionForm>
                  </details>
                </>
              )}
              {canNotice && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-[var(--brand)]">{t("lease.notice")}</summary>
                  <ActionForm action={recordNoticeAction} className="mt-3" dict={fixDict}>
                    <input type="hidden" name="id" value={lease.id} />
                    <Input
                      label={t("lease.moveOutDate")}
                      name="moveOutDate"
                      type="date"
                      required
                      defaultValue={dayInput(new Date(Math.min(lease.endDate.getTime(), today.getTime() + lease.noticeDays * 86_400_000)))}
                    />
                    <Textarea label={t("lease.noticeNote")} name="note" maxLength={1000} />
                    <SubmitButton variant="secondary">{t("lease.notice")}</SubmitButton>
                  </ActionForm>
                </details>
              )}
              {canTerminate && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-red-700 dark:text-red-400">{t("lease.terminate")}</summary>
                  <ActionForm action={terminateLeaseAction} className="mt-3" confirm={t("lease.terminateConfirm")} dict={fixDict}>
                    <input type="hidden" name="id" value={lease.id} />
                    <Input label={t("lease.terminateEnd")} name="endDate" type="date" required defaultValue={dayInput(lease.moveOutDate ?? today)} />
                    <Textarea label={t("lease.reason")} name="reason" required minLength={3} maxLength={1000} />
                    <SubmitButton variant="danger">{t("lease.terminate")}</SubmitButton>
                  </ActionForm>
                </details>
              )}
              {canRenew && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-[var(--brand)]">{t("lease.renew")}</summary>
                  <ActionForm action={createRenewalAction} className="mt-3" dict={fixDict}>
                    <input type="hidden" name="id" value={lease.id} />
                    <Input label={t("lease.renewalStart")} name="startDate" type="date" required defaultValue={dayInput(renewalStart)} />
                    <Input label={t("lease.renewalEnd")} name="endDate" type="date" required defaultValue={dayInput(renewalEnd)} />
                    <Input label={t("lease.newRent")} name="rentAmount" type="number" min={0} step="0.01" required defaultValue={lease.rentAmount.toString()} />
                    <Textarea label={t("lease.renewalNote")} name="note" maxLength={1000} />
                    <SubmitButton>{t("lease.renew")}</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </div>
          </Card>

          <Card title={t("lease.depositSummary")}>
            {lease.deposit ? (
              <DescriptionList
                items={[
                  { label: t("lease.depositRequired"), value: formatMoney(lease.deposit.required, fmt) },
                  { label: t("lease.depositStatus"), value: <Badge status={lease.deposit.status} /> },
                  { label: t("lease.depositReceived"), value: formatMoney(received.toString(), fmt) },
                  { label: t("lease.depositDeducted"), value: formatMoney(deducted.toString(), fmt) },
                  { label: t("lease.depositRefunded"), value: formatMoney(refunded.toString(), fmt) },
                  { label: t("lease.depositHeld"), value: <span className="font-semibold">{formatMoney(held.toString(), fmt)}</span> },
                  { label: t("lease.depositHeldIn"), value: lease.deposit.heldIn },
                ]}
              />
            ) : (
              <>
                <p className="text-sm text-slate-500">{t("lease.depositNone")}</p>
                {money(lease.depositAmount).gt(0) && <p className="mt-1 text-sm">{t("lease.depositRequired")}: {formatMoney(lease.depositAmount, fmt)}</p>}
              </>
            )}
          </Card>

          {perms.docs && (
            <Card title={t("lease.documents")}>
              {visibleDocs.length === 0 ? (
                <p className="text-sm text-slate-500">{t("lease.noDocuments")}</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {visibleDocs.map((d) => (
                    <li key={d.id} className="py-2">
                      <a className="font-medium text-[var(--brand)] hover:underline" href={`/api/documents/${d.id}`}>{d.name}</a>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <span>{Math.max(1, Math.round(d.size / 1024))} KB · {formatDate(d.createdAt, dfmt)}</span>
                        {d.visibleToTenant && <Badge tone="blue">{t("tenant.portalBadge")}</Badge>}
                        {d.sensitive && <Badge tone="red">{t("tenant.sensitiveBadge")}</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {perms.upload && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-[var(--brand)]">{t("lease.upload")}</summary>
                  <ActionForm action={uploadLeaseDocumentAction} resetOnSuccess className="mt-3" dict={fixDict}>
                    <input type="hidden" name="id" value={lease.id} />
                    <Input label={t("lease.file")} name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.docx" />
                    <Input label={t("lease.docName")} name="name" maxLength={200} />
                    <Checkbox label={t("lease.visibleToTenant")} name="visibleToTenant" />
                    <SubmitButton>{t("lease.upload")}</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
