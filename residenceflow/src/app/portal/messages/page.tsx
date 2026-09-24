import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, EmptyState, Input, PageHeader, Textarea, cn } from "@/components/ui";
import { markStaffMessagesRead } from "@/services/portal";
import { sendPortalMessageAction } from "../actions";
import { PORTAL_ERROR_KEYS, dictFor, portalPage } from "../kit";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function PortalMessagesPage() {
  const { ctx, tenantId, t, df } = await portalPage();
  const messages = await db.message.findMany({
    where: { organizationId: ctx.organizationId, tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unreadIds = new Set(messages.filter((m) => !m.fromTenant && !m.readAt).map((m) => m.id));
  if (unreadIds.size) await markStaffMessagesRead(ctx.organizationId, tenantId);
  const thread = [...messages].reverse();

  return (
    <>
      <PageHeader title={t("nav.portal.messages")} description={t("portal.msg.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {thread.length === 0 ? (
            <EmptyState title={t("portal.msg.none")} />
          ) : (
            <ol className="space-y-3" aria-label={t("nav.portal.messages")}>
              {thread.map((m) => (
                <li key={m.id} className={cn("flex", m.fromTenant ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg border px-3 py-2 text-sm shadow-sm",
                      m.fromTenant
                        ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950"
                        : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
                    )}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{m.fromTenant ? t("portal.msg.you") : m.authorName}</span>
                      <span>{formatDateTime(m.createdAt, df)}</span>
                      {unreadIds.has(m.id) && <span className="rounded-full bg-blue-100 px-1.5 text-blue-800 dark:bg-blue-900 dark:text-blue-200">{t("portal.msg.new")}</span>}
                    </div>
                    {m.subject && <div className="font-medium">{m.subject}</div>}
                    <p className="whitespace-pre-line">{m.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <Card title={t("portal.msg.write")}>
          <ActionForm action={sendPortalMessageAction} resetOnSuccess dict={dictFor(t, PORTAL_ERROR_KEYS)}>
            <Input label={t("portal.msg.subject")} name="subject" maxLength={150} />
            <Textarea label={t("portal.msg.body")} name="body" required maxLength={4000} rows={5} />
            <SubmitButton>{t("portal.msg.send")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
