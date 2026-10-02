import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireContext, tenantWhere } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, EmptyState, Input, PageHeader, Textarea, cn } from "@/components/ui";
import { replyToTenantAction } from "../actions";
import { messageMessages } from "../i18n";

export const metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

export default async function MessageThreadPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const ctx = await requireContext("message.view");
  const { t } = await getT(messageMessages);
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) notFound();
  const tenant = await db.tenant.findFirst({
    where: { ...tenantWhere(ctx), id: tenantId },
    select: { id: true, legalName: true, reference: true, phone: true, email: true, leases: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, select: { unit: { select: { number: true, property: { select: { name: true } } } } }, take: 1 } },
  });
  if (!tenant) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const df = { dateFormat: settings?.dateFormat ?? "dd/MM/yyyy", timezone: settings?.timezone ?? "Africa/Douala" };
  const messages = await db.message.findMany({ where: { organizationId: ctx.organizationId, tenantId }, orderBy: { createdAt: "desc" }, take: 200 });
  const unreadIds = new Set(messages.filter((m) => m.fromTenant && !m.readAt).map((m) => m.id));
  if (unreadIds.size) {
    await db.message.updateMany({ where: { organizationId: ctx.organizationId, tenantId, fromTenant: true, readAt: null }, data: { readAt: new Date() } });
  }
  const thread = [...messages].reverse();
  const unit = tenant.leases[0]?.unit;

  return (
    <>
      <PageHeader
        title={tenant.legalName}
        description={[tenant.reference, unit ? `${unit.property.name} ${unit.number}` : "", tenant.phone, tenant.email].filter(Boolean).join(" · ")}
        breadcrumbs={[{ label: t("msg.title"), href: "/messages" }, { label: tenant.legalName }]}
        actions={can(ctx, "tenant.view") && <Link className="text-sm text-[var(--brand)] hover:underline" href={`/tenants/${tenant.id}`}>{t("msg.tenantFile")}</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {thread.length === 0 ? (
            <EmptyState title={t("msg.emptyThread")} />
          ) : (
            <ol className="space-y-3">
              {thread.map((m) => (
                <li key={m.id} className={cn("flex", m.fromTenant ? "justify-start" : "justify-end")}>
                  <div className={cn("max-w-[85%] rounded-lg border px-3 py-2 text-sm shadow-sm", m.fromTenant ? "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" : "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950")}>
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{m.authorName}</span>
                      <span>{m.fromTenant ? t("msg.fromTenant") : t("msg.fromStaff")}</span>
                      <span>{formatDateTime(m.createdAt, df)}</span>
                      {unreadIds.has(m.id) && <span className="rounded-full bg-amber-100 px-1.5 text-amber-800">{t("msg.new")}</span>}
                      {!m.fromTenant && <span>{m.readAt ? t("msg.seen") : t("msg.notSeen")}</span>}
                    </div>
                    {m.subject && <div className="font-medium">{m.subject}</div>}
                    <p className="whitespace-pre-line">{m.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        {can(ctx, "message.send") && (
          <Card title={t("msg.reply")}>
            <ActionForm action={replyToTenantAction} resetOnSuccess dict={{ "msg.sent": t("msg.sent") }}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              <Input label={t("msg.subject")} name="subject" maxLength={150} />
              <Textarea label={t("msg.body")} name="body" required maxLength={4000} rows={6} />
              <SubmitButton>{t("msg.send")}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
