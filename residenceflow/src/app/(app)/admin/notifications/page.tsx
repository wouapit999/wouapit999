import { requireContext } from "@/lib/auth/context";
import { emailConfigured } from "@/lib/notify/email";
import { DEFAULT_TEMPLATES } from "@/domain/template";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { adminDict, adminMessages } from "../messages";
import { sendTestEmailAction } from "./actions";

export const metadata = { title: "Notifications" };

function placeholders(...s: string[]) {
  return [...new Set(s.flatMap((x) => [...x.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((m) => m[1])))];
}

export default async function NotificationsSettingsPage() {
  const ctx = await requireContext("settings.notifications.manage");
  const { t } = await getT(adminMessages);
  const email = emailConfigured();
  const channels = [
    { key: "inApp", on: true, note: t("adm.notif.inAppNote") },
    { key: "email", on: email, note: email ? t("adm.notif.emailOn") : t("adm.notif.emailOff") },
    { key: "sms", on: false, note: t("adm.notif.adapterMissing") },
    { key: "whatsapp", on: false, note: t("adm.notif.adapterMissing") },
  ];
  return (
    <>
      <PageHeader title={t("adm.notif.title")} description={t("adm.notif.subtitle")} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {channels.map((c) => (
          <Card key={c.key}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t(`adm.notif.channel.${c.key}`)}</h2>
              {c.on ? <Badge tone="green">{t("adm.active")}</Badge> : <Badge tone="slate">{t("adm.notConfigured")}</Badge>}
            </div>
            <p className="mt-2 text-xs text-slate-500">{c.note}</p>
          </Card>
        ))}
      </div>
      <Card title={t("adm.notif.test")} className="mb-6">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("adm.notif.testHint", { email: ctx.user.email })}</p>
        <ActionForm action={sendTestEmailAction} dict={adminDict(t)}>
          <SubmitButton variant="secondary">{t("adm.notif.sendTest")}</SubmitButton>
        </ActionForm>
      </Card>
      <Card title={t("adm.notif.templates")}>
        <p className="mb-3 text-xs text-slate-500">{t("adm.notif.templatesHint")}</p>
        <Table>
          <thead><tr><Th>{t("adm.notif.event")}</Th><Th>English</Th><Th>Français</Th><Th>{t("adm.notif.placeholders")}</Th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {Object.entries(DEFAULT_TEMPLATES).map(([key, tpl]) => (
              <Tr key={key}>
                <Td className="font-mono text-xs">{key}</Td>
                <Td><div className="font-medium">{tpl.en.title}</div><div className="text-xs text-slate-500">{tpl.en.body}</div></Td>
                <Td><div className="font-medium">{tpl.fr.title}</div><div className="text-xs text-slate-500">{tpl.fr.body}</div></Td>
                <Td className="text-xs">{placeholders(tpl.en.title, tpl.en.body, tpl.fr.title, tpl.fr.body).map((p) => <code key={p} className="mr-1 inline-block rounded bg-slate-100 px-1 dark:bg-slate-800">{`{{${p}}}`}</code>)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
