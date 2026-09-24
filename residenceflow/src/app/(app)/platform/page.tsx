import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/i18n";
import { InlineAction, SubmitButton } from "@/components/forms";
import { ResultForm } from "@/components/admin/result-form";
import { Badge, Card, EmptyState, Input, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { platformMessages } from "./messages";
import { createOrganizationAction, setOrganizationStatusAction } from "./actions";

export const metadata = { title: "Platform" };

/** Platform super-admin console: organizations only — no tenant or financial data is queried. */
export default async function PlatformPage() {
  await requireContext("platform.organizations.manage");
  const { t } = await getT(platformMessages);
  const orgs = await db.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, slug: true, status: true, createdAt: true, _count: { select: { users: true, properties: true } } },
  });
  const fmt = { timezone: "UTC", dateFormat: "yyyy-MM-dd" };
  const dict = Object.fromEntries(["plat.created", "plat.saved", "plat.slugTaken", "plat.emailTaken", "plat.notFound"].map((k) => [k, t(k)]));

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
                      <div className="flex flex-wrap gap-1">
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
          <ResultForm
            action={createOrganizationAction}
            dict={dict}
            resetOnSuccess
            labels={{ link: t("plat.link"), emailSent: t("plat.emailSent"), emailNotSent: t("plat.emailNotSent"), once: t("plat.once"), copy: t("plat.copy"), copied: t("plat.copied") }}
          >
            <Input label={t("plat.orgName")} name="name" required maxLength={200} />
            <Input label={t("plat.slug")} name="slug" required maxLength={50} hint={t("plat.slugHint")} />
            <Input label={t("plat.adminName")} name="adminName" required maxLength={120} />
            <Input label={t("plat.adminEmail")} name="adminEmail" type="email" required maxLength={200} />
            <p className="text-xs text-slate-500">{t("plat.createHint")}</p>
            <SubmitButton>{t("common.create")}</SubmitButton>
          </ResultForm>
        </Card>
      </div>
    </>
  );
}
