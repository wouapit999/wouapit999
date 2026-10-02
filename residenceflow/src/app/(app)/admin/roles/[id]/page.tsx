import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { PERMISSION_GROUPS, PLATFORM_ONLY, POWERFUL_PERMISSIONS } from "@/lib/permissions";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { PermissionMatrix, type MatrixGroup } from "@/components/admin/permission-matrix";
import { Alert, Badge, Card, Input, PageHeader, Select } from "@/components/ui";
import { hasRecentReauth } from "@/services/reauth";
import { ORG_ADMIN_ROLE_KEY, ROLES_MANAGE } from "@/services/admin";
import { adminDict, adminMessages } from "../../messages";
import { ReauthCard } from "../../reauth-card";
import { ORG_ROLE_SCOPES } from "../../constants";
import { cloneRoleAction, setRoleStateAction, updateRoleDetailsAction, updateRolePermissionsAction } from "../actions";

export const metadata = { title: "Role" };

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("settings.roles.manage");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t } = await getT(adminMessages);
  const role = await db.role.findFirst({
    where: { id, organizationId: ctx.organizationId || "__none__" },
    include: { users: { take: 50, include: { user: { select: { id: true, name: true, email: true, status: true } } } }, _count: { select: { users: true } } },
  });
  if (!role || role.scope === "PLATFORM") notFound();
  const reauthOk = await hasRecentReauth(ctx);
  const dict = adminDict(t);
  const pact = (p: string) => {
    const suffix = p.split(".").slice(1).join(".");
    const label = t(`adm.pact.${suffix}`);
    return label === `adm.pact.${suffix}` ? suffix : label;
  };
  const groups: MatrixGroup[] = Object.entries(PERMISSION_GROUPS)
    .map(([key, perms]) => ({
      key,
      label: t(`adm.pgroup.${key}`),
      permissions: perms
        .filter((p) => !(PLATFORM_ONLY as string[]).includes(p))
        .map((p) => ({
          value: p as string,
          label: pact(p),
          powerful: (POWERFUL_PERMISSIONS as string[]).includes(p),
          locked: role.key === ORG_ADMIN_ROLE_KEY && p === ROLES_MANAGE,
        })),
    }))
    .filter((g) => g.permissions.length > 0);

  return (
    <>
      <PageHeader
        title={role.name}
        description={role.description}
        breadcrumbs={[{ label: t("adm.roles.title"), href: "/admin/roles" }, { label: role.name }]}
        actions={
          <>
            {!role.archived && <InlineAction action={cloneRoleAction} label={t("adm.roles.clone")} hidden={{ id: role.id }} />}
            {!role.archived && role.active && <InlineAction action={setRoleStateAction} label={t("adm.roles.deactivate")} variant="secondary" confirm={t("adm.roles.deactivateConfirm")} hidden={{ id: role.id, op: "deactivate" }} />}
            {!role.archived && !role.active && <InlineAction action={setRoleStateAction} label={t("adm.roles.activate")} hidden={{ id: role.id, op: "activate" }} />}
            {!role.archived && !role.isSystem && <InlineAction action={setRoleStateAction} label={t("adm.roles.archive")} variant="danger" confirm={t("adm.roles.archiveConfirm")} hidden={{ id: role.id, op: "archive" }} />}
            {role.archived && <InlineAction action={setRoleStateAction} label={t("adm.roles.restore")} hidden={{ id: role.id, op: "restore" }} />}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={role.isSystem ? "violet" : "blue"}>{role.isSystem ? t("adm.roles.system") : t("adm.roles.custom")}</Badge>
        {role.archived ? <Badge status="ARCHIVED">{t("adm.status.ARCHIVED")}</Badge> : role.active ? <Badge status="ACTIVE">{t("adm.roles.active")}</Badge> : <Badge status="INACTIVE">{t("adm.roles.inactive")}</Badge>}
        <span className="font-mono text-xs text-slate-500">{t("adm.roles.key")}: {role.key}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("adm.roles.permissions")}>
            {role.key === ORG_ADMIN_ROLE_KEY && <div className="mb-3"><Alert tone="info">{t("adm.roles.orgAdminNote")}</Alert></div>}
            <div className="mb-4"><ReauthCard ok={reauthOk} t={t} /></div>
            <ActionForm action={updateRolePermissionsAction} dict={dict}>
              <input type="hidden" name="id" value={role.id} />
              <Select label={t("adm.roles.scope")} name="scope" defaultValue={role.scope} options={ORG_ROLE_SCOPES.map((s) => ({ value: s, label: t(`adm.scope.${s}`) }))} wrapperClassName="max-w-xs" hint={t("adm.roles.scopeHint")} />
              <PermissionMatrix
                groups={groups}
                initial={role.permissions}
                labels={{
                  selectAll: t("adm.roles.selectAll"),
                  clearAll: t("adm.roles.clearAll"),
                  readOnly: t("adm.roles.readOnlyPreset"),
                  powerful: t("adm.roles.powerful"),
                  locked: t("adm.roles.locked"),
                  selected: t("adm.roles.selectedCount"),
                }}
              />
              <SubmitButton>{t("adm.roles.savePermissions")}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title={t("adm.roles.details")}>
            <ActionForm action={updateRoleDetailsAction} dict={dict}>
              <input type="hidden" name="id" value={role.id} />
              <Input label={t("common.name")} name="name" defaultValue={role.name} required maxLength={80} />
              <Input label={t("adm.roles.description")} name="description" defaultValue={role.description} maxLength={500} />
              <SubmitButton>{t("common.save")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card title={`${t("adm.roles.users")} (${role._count.users})`}>
            {role.users.length === 0 ? (
              <p className="text-sm text-slate-500">{t("common.none")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {role.users.map((u) => (
                  <li key={u.user.id} className="flex items-center justify-between gap-2">
                    <Link className="truncate text-[var(--brand)] hover:underline" href={`/admin/users/${u.user.id}`}>{u.user.name}</Link>
                    <Badge status={u.user.status}>{t(`adm.status.${u.user.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
