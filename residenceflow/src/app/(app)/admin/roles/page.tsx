import Link from "next/link";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, Input, PageHeader, Select, Table, Td, Th, Tr, str } from "@/components/ui";
import { adminDict, adminMessages } from "../messages";
import { ORG_ROLE_SCOPES } from "../constants";
import { cloneRoleAction, createRoleAction } from "./actions";

export const metadata = { title: "Roles" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("settings.roles.manage");
  const { t } = await getT(adminMessages);
  const showArchived = str((await searchParams).archived) === "1";
  const roles = await db.role.findMany({
    where: { organizationId: ctx.organizationId || "__none__", ...(showArchived ? {} : { archived: false }) },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: { _count: { select: { users: true } } },
  });

  return (
    <>
      <PageHeader title={t("adm.roles.title")} description={t("adm.roles.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-2 text-right text-sm">
            <Link className="text-[var(--brand)] hover:underline" href={showArchived ? "/admin/roles" : "/admin/roles?archived=1"}>
              {showArchived ? t("adm.roles.hideArchived") : t("adm.roles.showArchived")}
            </Link>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>{t("common.name")}</Th>
                <Th>{t("adm.roles.scope")}</Th>
                <Th>{t("adm.roles.permissions")}</Th>
                <Th>{t("adm.roles.users")}</Th>
                <Th>{t("common.status")}</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {roles.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/admin/roles/${r.id}`} className="font-medium text-[var(--brand)] hover:underline">{r.name}</Link>
                    <div className="font-mono text-xs text-slate-500">{r.key}</div>
                  </Td>
                  <Td className="text-xs">{t(`adm.scope.${r.scope}`)}</Td>
                  <Td>{r.permissions.length}</Td>
                  <Td>{r._count.users}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {r.isSystem ? <Badge tone="violet">{t("adm.roles.system")}</Badge> : <Badge tone="blue">{t("adm.roles.custom")}</Badge>}
                      {r.archived ? <Badge status="ARCHIVED">{t("adm.status.ARCHIVED")}</Badge> : r.active ? <Badge status="ACTIVE">{t("adm.roles.active")}</Badge> : <Badge status="INACTIVE">{t("adm.roles.inactive")}</Badge>}
                    </div>
                  </Td>
                  <Td>{!r.archived && <InlineAction action={cloneRoleAction} label={t("adm.roles.clone")} hidden={{ id: r.id }} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
        <Card title={t("adm.roles.create")}>
          <ActionForm action={createRoleAction} dict={adminDict(t)}>
            <Input label={t("common.name")} name="name" required maxLength={80} />
            <Input label={t("adm.roles.description")} name="description" maxLength={500} />
            <Select label={t("adm.roles.scope")} name="scope" defaultValue="ASSIGNED_BUILDINGS" options={ORG_ROLE_SCOPES.map((s) => ({ value: s, label: t(`adm.scope.${s}`) }))} />
            <p className="text-xs text-slate-500">{t("adm.roles.createHint")}</p>
            <SubmitButton>{t("common.create")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
