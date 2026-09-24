import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, invoiceWhere, leaseWhere, maintenanceWhere, paymentWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { canAccessDocument } from "@/lib/storage";
import { formatDate, formatDay, formatMoney } from "@/lib/format";
import { invoiceBalance, tenantBalance } from "@/services/billing";
import { loadScopedTenant } from "@/services/tenants";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, DescriptionList, Input, LinkButton, PageHeader, Select, Table, Td, Th, Tr } from "@/components/ui";
import { leaseMessages } from "../../leases/messages";
import {
  addContactAction,
  invitePortalUserAction,
  removeContactAction,
  resendActivationAction,
  uploadTenantDocumentAction,
} from "../actions";
import { CONTACT_KINDS, PORTAL_ROLES, tenantMessages, tenantStatusTone } from "../messages";
import { LinkActionForm } from "../portal-forms";

export const metadata = { title: "Tenant" };

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("tenant.view");
  const { t, locale } = await getT(tenantMessages, leaseMessages);
  const tenant = await loadScopedTenant(ctx, id);
  if (!tenant) notFound();

  const perms = {
    update: can(ctx, "tenant.update"),
    notes: can(ctx, "tenant.notes.view"),
    leases: can(ctx, "lease.view"),
    newLease: can(ctx, "lease.create"),
    invoices: can(ctx, "invoice.view"),
    payments: can(ctx, "payment.view"),
    maintenance: can(ctx, "maintenance.view"),
    docs: can(ctx, "document.view"),
    upload: can(ctx, "document.upload"),
    users: can(ctx, "users.manage"),
  };

  const [contacts, leases, balance, openInvoices, payments, maintenance, documents, portalUsers, settings] = await Promise.all([
    db.tenantContact.findMany({ where: { tenantId: tenant.id }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    perms.leases
      ? db.lease.findMany({
          where: { ...leaseWhere(ctx), tenantId: tenant.id },
          orderBy: { startDate: "desc" },
          include: { unit: { select: { id: true, number: true, block: true, property: { select: { name: true } } } } },
        })
      : Promise.resolve([]),
    perms.invoices ? tenantBalance(tenant.id) : Promise.resolve(null),
    perms.invoices
      ? db.invoice.findMany({
          where: { ...invoiceWhere(ctx), tenantId: tenant.id, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } },
          orderBy: { dueDate: "asc" },
          take: 20,
        })
      : Promise.resolve([]),
    perms.payments
      ? db.payment.findMany({ where: { ...paymentWhere(ctx), tenantId: tenant.id }, orderBy: { paymentDate: "desc" }, take: 10 })
      : Promise.resolve([]),
    perms.maintenance
      ? db.maintenanceRequest.findMany({ where: { ...maintenanceWhere(ctx), tenantId: tenant.id }, orderBy: { createdAt: "desc" }, take: 10 })
      : Promise.resolve([]),
    perms.docs
      ? db.document.findMany({
          where: { organizationId: ctx.organizationId, tenantId: tenant.id },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true, name: true, category: true, size: true, createdAt: true, version: true,
            organizationId: true, tenantId: true, propertyId: true, leaseId: true, workOrderId: true,
            visibleToTenant: true, sensitive: true, uploadedById: true,
          },
        })
      : Promise.resolve([]),
    perms.users
      ? db.user.findMany({
          where: { organizationId: ctx.organizationId, tenantId: tenant.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, email: true, status: true, roles: { select: { role: { select: { key: true } } } } },
        })
      : Promise.resolve([]),
    getOrgSettings(ctx.organizationId),
  ]);
  const visibleDocs = (await Promise.all(documents.map(async (d) => ((await canAccessDocument(ctx, d)) ? d : null)))).filter((d) => d !== null);

  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const dfmt = { timezone: settings?.timezone ?? "Africa/Douala", dateFormat: settings?.dateFormat ?? "dd/MM/yyyy" };
  const fixDict = { "Please correct the highlighted fields.": t("tenant.fixFields") };
  const linkLabels = {
    linkOnce: t("tenant.portal.linkOnce"),
    emailed: t("tenant.portal.emailed"),
    notEmailed: t("tenant.portal.notEmailed"),
    fixFields: t("tenant.fixFields"),
  };

  return (
    <>
      <PageHeader
        title={tenant.legalName}
        description={`${tenant.reference} · ${t(`tenant.type.${tenant.type}`)}`}
        breadcrumbs={[{ label: t("tenant.title"), href: "/tenants" }, { label: tenant.legalName }]}
        actions={
          <>
            {perms.newLease && <LinkButton href={`/leases/new?tenantId=${tenant.id}`}>{t("tenant.newLease")}</LinkButton>}
            {perms.update && <LinkButton variant="secondary" href={`/tenants/${tenant.id}/edit`}>{t("common.edit")}</LinkButton>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("tenant.profile")}>
            <DescriptionList
              items={[
                { label: t("common.status"), value: <Badge tone={tenantStatusTone(tenant.status)}>{t(`tenant.status.${tenant.status}`)}</Badge> },
                { label: t("tenant.preferredName"), value: tenant.preferredName },
                { label: t("common.email"), value: tenant.email ? <a className="hover:underline" href={`mailto:${tenant.email}`}>{tenant.email}</a> : null },
                { label: t("common.phone"), value: [tenant.phone, tenant.altPhone].filter(Boolean).join(" · ") },
                { label: t("tenant.postalAddress"), value: tenant.postalAddress },
                { label: t("tenant.previousAddress"), value: tenant.previousAddress },
                { label: t("tenant.employer"), value: tenant.employer },
                { label: t("tenant.idType"), value: tenant.idType ? t(`tenant.idType.${tenant.idType}`) : null },
                { label: t("tenant.idNumber"), value: tenant.idNumberMasked ? <span className="font-mono">{tenant.idNumberMasked}</span> : null },
                { label: t("tenant.idIssueDate"), value: tenant.idIssueDate ? formatDay(tenant.idIssueDate, dfmt) : null },
                { label: t("tenant.idExpiryDate"), value: tenant.idExpiryDate ? formatDay(tenant.idExpiryDate, dfmt) : null },
                { label: t("tenant.language"), value: t(`tenant.lang.${tenant.language}`) },
                { label: t("tenant.comm"), value: tenant.commPreferences.map((p) => t(`tenant.comm.${p}`)).join(", ") },
              ]}
            />
          </Card>

          <Card title={t("tenant.contacts")}>
            {contacts.length === 0 ? (
              <p className="text-sm text-slate-500">{t("common.none")}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("tenant.contact.kind")}</Th>
                    <Th>{t("common.name")}</Th>
                    <Th>{t("common.phone")} / {t("common.email")}</Th>
                    {perms.update && <Th><span className="sr-only">{t("common.actions")}</span></Th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {contacts.map((c) => (
                    <Tr key={c.id}>
                      <Td><Badge tone="slate">{t(`tenant.contact.kind.${c.kind}`)}</Badge></Td>
                      <Td>
                        {c.name}
                        {c.relationship && <div className="text-xs text-slate-500">{c.relationship}</div>}
                      </Td>
                      <Td>
                        <div>{c.phone || "—"}</div>
                        <div className="text-xs text-slate-500">{c.email}</div>
                      </Td>
                      {perms.update && (
                        <Td>
                          <InlineAction action={removeContactAction} label={t("tenant.contact.remove")} variant="ghost" confirm={t("tenant.contact.removeConfirm")} hidden={{ tenantId: tenant.id, contactId: c.id }} />
                        </Td>
                      )}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {perms.update && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-[var(--brand)]">{t("tenant.contact.add")}</summary>
                <ActionForm action={addContactAction} resetOnSuccess className="mt-3" dict={fixDict}>
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select label={t("tenant.contact.kind")} name="kind" required options={CONTACT_KINDS.map((k) => ({ value: k, label: t(`tenant.contact.kind.${k}`) }))} />
                    <Input label={t("common.name")} name="name" required minLength={2} maxLength={200} />
                    <Input label={t("tenant.contact.relationship")} name="relationship" maxLength={100} />
                    <Input label={t("common.phone")} name="phone" type="tel" maxLength={40} />
                    <Input label={t("common.email")} name="email" type="email" maxLength={200} />
                  </div>
                  <SubmitButton>{t("tenant.contact.add")}</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Card>

          {perms.leases && (
            <Card title={t("tenant.leases")} actions={perms.newLease && <LinkButton variant="secondary" href={`/leases/new?tenantId=${tenant.id}`}>{t("tenant.newLease")}</LinkButton>}>
              {leases.length === 0 ? (
                <p className="text-sm text-slate-500">{t("common.none")}</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("lease.reference")}</Th>
                      <Th>{t("common.unit")}</Th>
                      <Th>{t("lease.dates")}</Th>
                      <Th>{t("lease.rent")}</Th>
                      <Th>{t("common.status")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {leases.map((l) => (
                      <Tr key={l.id}>
                        <Td><Link className="font-mono text-xs text-[var(--brand)] hover:underline" href={`/leases/${l.id}`}>{l.reference}</Link></Td>
                        <Td><Link className="hover:underline" href={`/units/${l.unit.id}`}>{l.unit.property.name} · {l.unit.block ? `${l.unit.block} · ` : ""}{l.unit.number}</Link></Td>
                        <Td className="whitespace-nowrap">{formatDay(l.startDate, dfmt)} → {formatDay(l.endDate, dfmt)}</Td>
                        <Td className="whitespace-nowrap">{formatMoney(l.rentAmount, fmt)}</Td>
                        <Td><Badge status={l.status}>{t(`lease.status.${l.status}`)}</Badge></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          {perms.invoices && balance && (
            <Card title={t("tenant.openInvoices")}>
              {openInvoices.length === 0 ? (
                <p className="text-sm text-slate-500">{t("common.none")}</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("tenant.invoice")}</Th>
                      <Th>{t("tenant.dueDate")}</Th>
                      <Th className="text-right">{t("tenant.total")}</Th>
                      <Th className="text-right">{t("tenant.outstanding")}</Th>
                      <Th>{t("common.status")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {openInvoices.map((inv) => (
                      <Tr key={inv.id}>
                        <Td><Link className="font-mono text-xs text-[var(--brand)] hover:underline" href={`/invoices/${inv.id}`}>{inv.number}</Link></Td>
                        <Td className="whitespace-nowrap">{formatDay(inv.dueDate, dfmt)}</Td>
                        <Td className="whitespace-nowrap text-right">{formatMoney(inv.total, fmt)}</Td>
                        <Td className="whitespace-nowrap text-right">{formatMoney(invoiceBalance(inv).toString(), fmt)}</Td>
                        <Td><Badge status={inv.status} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          {perms.payments && (
            <Card title={t("tenant.recentPayments")}>
              {payments.length === 0 ? (
                <p className="text-sm text-slate-500">{t("common.none")}</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("tenant.payment")}</Th>
                      <Th>{t("common.date")}</Th>
                      <Th>{t("tenant.method")}</Th>
                      <Th className="text-right">{t("common.amount")}</Th>
                      <Th>{t("common.status")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {payments.map((p) => (
                      <Tr key={p.id}>
                        <Td><Link className="font-mono text-xs text-[var(--brand)] hover:underline" href={`/payments/${p.id}`}>{p.reference}</Link></Td>
                        <Td className="whitespace-nowrap">{formatDay(p.paymentDate, dfmt)}</Td>
                        <Td>{p.method}</Td>
                        <Td className="whitespace-nowrap text-right">{formatMoney(p.amount, fmt)}</Td>
                        <Td><Badge status={p.status} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          {perms.maintenance && (
            <Card title={t("tenant.maintenance")}>
              {maintenance.length === 0 ? (
                <p className="text-sm text-slate-500">{t("common.none")}</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {maintenance.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <Link className="font-mono text-xs text-[var(--brand)] hover:underline" href={`/maintenance/${m.id}`}>{m.number}</Link> · {m.title}
                        <span className="block text-xs text-slate-500">{formatDate(m.createdAt, dfmt)}</span>
                      </span>
                      <Badge status={m.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {perms.invoices && balance && (
            <Card title={t("tenant.balanceSummary")}>
              <DescriptionList
                items={[
                  { label: t("tenant.outstanding"), value: formatMoney(balance.outstanding.toString(), fmt) },
                  { label: t("tenant.credit"), value: formatMoney(balance.credit.toString(), fmt) },
                  {
                    label: t("tenant.net"),
                    value: <span className={balance.net.gt(0) ? "font-semibold text-red-700 dark:text-red-400" : "font-semibold"}>{formatMoney(balance.net.toString(), fmt)}</span>,
                  },
                ]}
              />
            </Card>
          )}

          {perms.docs && (
            <Card title={t("tenant.documents")}>
              {visibleDocs.length === 0 ? (
                <p className="text-sm text-slate-500">{t("tenant.noDocuments")}</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {visibleDocs.map((d) => (
                    <li key={d.id} className="py-2">
                      <a className="font-medium text-[var(--brand)] hover:underline" href={`/api/documents/${d.id}`}>{d.name}</a>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <span>{d.category} · {Math.max(1, Math.round(d.size / 1024))} KB · {formatDate(d.createdAt, dfmt)}</span>
                        {d.sensitive && <Badge tone="red">{t("tenant.sensitiveBadge")}</Badge>}
                        {d.visibleToTenant && <Badge tone="blue">{t("tenant.portalBadge")}</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {perms.upload && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-[var(--brand)]">{t("tenant.upload")}</summary>
                  <ActionForm action={uploadTenantDocumentAction} resetOnSuccess className="mt-3" dict={fixDict}>
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <Input label={t("tenant.file")} name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.csv" />
                    <Input label={t("tenant.docName")} name="name" maxLength={200} />
                    <Checkbox label={t("tenant.visibleToTenant")} name="visibleToTenant" />
                    <Checkbox label={t("tenant.sensitive")} name="sensitive" />
                    <SubmitButton>{t("tenant.upload")}</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </Card>
          )}

          {perms.notes && (
            <Card title={t("tenant.notes")}>
              {tenant.notes ? <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{tenant.notes}</p> : <p className="text-sm text-slate-500">{t("common.none")}</p>}
            </Card>
          )}

          {perms.users && (
            <Card title={t("tenant.portal")}>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{t("tenant.portal.hint")}</p>
              {portalUsers.length === 0 ? (
                <p className="text-sm text-slate-500">{t("tenant.portal.none")}</p>
              ) : (
                <ul className="mb-4 space-y-3 text-sm">
                  {portalUsers.map((u) => (
                    <li key={u.id} className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{u.name}</span>
                        <Badge status={u.status}>{t(`tenant.user.status.${u.status}`)}</Badge>
                        {u.roles.map((r) => (
                          <Badge key={r.role.key} tone="violet">{(PORTAL_ROLES as readonly string[]).includes(r.role.key) ? t(`tenant.portal.role.${r.role.key}`) : r.role.key}</Badge>
                        ))}
                      </div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                      {u.status === "INVITED" && (
                        <LinkActionForm action={resendActivationAction} labels={{ ...linkLabels, submit: t("tenant.portal.resend") }} compact>
                          <input type="hidden" name="tenantId" value={tenant.id} />
                          <input type="hidden" name="userId" value={u.id} />
                        </LinkActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <LinkActionForm action={invitePortalUserAction} labels={{ ...linkLabels, submit: t("tenant.portal.invite") }}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <Input label={t("common.name")} name="name" required minLength={2} maxLength={200} defaultValue={portalUsers.length === 0 ? tenant.legalName : ""} />
                <Input label={t("common.email")} name="email" type="email" required maxLength={200} defaultValue={portalUsers.length === 0 ? tenant.email : ""} />
                <Select label={t("tenant.portal.role")} name="roleKey" defaultValue={portalUsers.length === 0 ? "tenant" : "occupant"} options={PORTAL_ROLES.map((r) => ({ value: r, label: t(`tenant.portal.role.${r}`) }))} />
              </LinkActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
