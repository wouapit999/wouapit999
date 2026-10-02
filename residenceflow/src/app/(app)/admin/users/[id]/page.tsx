import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireContext } from "@/lib/auth/context";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/i18n";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { ResultForm } from "@/components/admin/result-form";
import { Alert, Badge, Card, Checkbox, DescriptionList, Input, PageHeader, Select, Table, Td, Th, Tr } from "@/components/ui";
import { hasRecentReauth } from "@/services/reauth";
import { adminDict, adminMessages, resultLabels } from "../../messages";
import { ReauthCard } from "../../reauth-card";
import { AccessFields } from "../access-fields";
import { assignableRoles, orgProperties } from "../load";
import {
  forcePasswordChangeAction,
  resetMfaAction,
  revokeAllUserSessionsAction,
  revokeUserSessionAction,
  sendResetLinkAction,
  setUserStatusAction,
  unlockUserAction,
  updateUserAccessAction,
  updateUserProfileAction,
} from "../actions";

export const metadata = { title: "User" };

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("users.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t } = await getT(adminMessages);
  const user = await db.user.findFirst({
    where: { id, organizationId: ctx.organizationId || "__none__" },
    select: {
      id: true, name: true, email: true, username: true, phone: true, locale: true, status: true, createdAt: true,
      lastLoginAt: true, lockedUntil: true, failedLoginCount: true, mustChangePassword: true, mfaEnabled: true,
      passwordChangedAt: true, mfaRecoveryCodes: true,
      roles: { select: { roleId: true, role: { select: { name: true } } } },
      propertyScopes: { select: { propertyId: true, property: { select: { name: true } } } },
    },
  });
  if (!user) notFound();
  const now = new Date();
  const settings = await getOrgSettings(ctx.organizationId);
  const fmt = { timezone: settings?.timezone ?? "UTC", dateFormat: settings?.dateFormat };
  const manage = can(ctx, "users.manage");
  const canReset = can(ctx, "users.password_reset");
  const canMfa = can(ctx, "users.mfa_reset");
  const self = user.id === ctx.user.id;
  const heldRoleIds = user.roles.map((r) => r.roleId);

  const [roles, properties, sessions, attempts, reauthOk] = await Promise.all([
    manage ? assignableRoles(ctx, heldRoleIds) : Promise.resolve([]),
    manage ? orgProperties(ctx) : Promise.resolve([]),
    db.session.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } }, orderBy: { lastSeenAt: "desc" }, take: 20, select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, mfaPending: true } }),
    db.loginAttempt.findMany({
      where: { OR: [{ userId: user.id }, { identifier: user.email }, ...(user.username ? [{ identifier: user.username }] : [])] },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, createdAt: true, ip: true, success: true, reason: true },
    }),
    canMfa ? hasRecentReauth(ctx) : Promise.resolve(false),
  ]);
  const locked = user.lockedUntil && user.lockedUntil > now;
  const dict = adminDict(t);

  return (
    <>
      <PageHeader
        title={user.name}
        description={user.email}
        breadcrumbs={[{ label: t("adm.users.title"), href: "/admin/users" }, { label: user.name }]}
        actions={manage && !self && (
          <>
            {(user.status === "SUSPENDED" || user.status === "ARCHIVED") && (
              <InlineAction action={setUserStatusAction} label={user.status === "ARCHIVED" ? t("adm.users.restore") : t("adm.users.activate")} hidden={{ id: user.id, status: "ACTIVE" }} />
            )}
            {(user.status === "ACTIVE" || user.status === "INVITED") && (
              <InlineAction action={setUserStatusAction} label={t("adm.users.suspend")} variant="danger" confirm={t("adm.users.suspendConfirm")} hidden={{ id: user.id, status: "SUSPENDED" }} />
            )}
            {user.status !== "ARCHIVED" && (
              <InlineAction action={setUserStatusAction} label={t("adm.users.archive")} variant="secondary" confirm={t("adm.users.archiveConfirm")} hidden={{ id: user.id, status: "ARCHIVED" }} />
            )}
          </>
        )}
      />
      {self && <div className="mb-4"><Alert tone="info">{t("adm.users.selfNote")}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("adm.users.profile")}>
            {manage ? (
              <ActionForm action={updateUserProfileAction} dict={dict}>
                <input type="hidden" name="id" value={user.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label={t("common.name")} name="name" defaultValue={user.name} required maxLength={120} />
                  <Input label={t("common.phone")} name="phone" type="tel" defaultValue={user.phone ?? ""} maxLength={40} />
                  <Select label={t("common.language")} name="locale" defaultValue={user.locale ?? ""} placeholder={t("adm.users.orgDefault")} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} />
                </div>
                <SubmitButton>{t("common.save")}</SubmitButton>
              </ActionForm>
            ) : (
              <DescriptionList items={[{ label: t("common.name"), value: user.name }, { label: t("common.phone"), value: user.phone }, { label: t("common.language"), value: user.locale }]} />
            )}
          </Card>

          <Card title={t("adm.users.access")}>
            {manage ? (
              <ActionForm action={updateUserAccessAction} dict={dict}>
                <input type="hidden" name="id" value={user.id} />
                <AccessFields roles={roles} properties={properties} selectedRoles={heldRoleIds} selectedProperties={user.propertyScopes.map((s) => s.propertyId)} t={t} />
                {!can(ctx, "settings.roles.manage") && <p className="text-xs text-slate-500">{t("adm.users.powerfulNote")}</p>}
                <SubmitButton>{t("common.save")}</SubmitButton>
              </ActionForm>
            ) : (
              <DescriptionList items={[
                { label: t("adm.users.roles"), value: user.roles.map((r) => r.role.name).join(", ") },
                { label: t("adm.users.buildings"), value: user.propertyScopes.map((s) => s.property.name).join(", ") },
              ]} />
            )}
          </Card>

          <Card title={t("adm.sessions.title")} actions={manage && sessions.length > 0 && (
            <InlineAction action={revokeAllUserSessionsAction} label={self ? t("adm.sessions.revokeOthers") : t("adm.sessions.revokeAll")} variant="danger" confirm={t("adm.sessions.revokeConfirm")} hidden={{ id: user.id }} />
          )}>
            {sessions.length === 0 ? (
              <p className="text-sm text-slate-500">{t("adm.sessions.none")}</p>
            ) : (
              <Table>
                <thead><tr><Th>{t("adm.sessions.started")}</Th><Th>{t("adm.sessions.lastSeen")}</Th><Th>IP</Th><Th>{t("adm.sessions.device")}</Th><Th /></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sessions.map((s) => (
                    <Tr key={s.id}>
                      <Td className="whitespace-nowrap text-xs">{formatDateTime(s.createdAt, fmt)}</Td>
                      <Td className="whitespace-nowrap text-xs">{formatDateTime(s.lastSeenAt, fmt)}{s.id === ctx.sessionId && <> <Badge tone="blue">{t("adm.sessions.current")}</Badge></>}</Td>
                      <Td className="font-mono text-xs">{s.ip ?? "—"}</Td>
                      <Td className="max-w-xs truncate text-xs" >{s.userAgent || "—"}</Td>
                      <Td>{manage && s.id !== ctx.sessionId && <InlineAction action={revokeUserSessionAction} label={t("adm.sessions.revoke")} hidden={{ id: user.id, sessionId: s.id }} />}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title={t("adm.users.loginHistory")}>
            {attempts.length === 0 ? (
              <p className="text-sm text-slate-500">{t("common.empty")}</p>
            ) : (
              <Table>
                <thead><tr><Th>{t("common.date")}</Th><Th>IP</Th><Th>{t("adm.security.outcome")}</Th><Th>{t("common.reason")}</Th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {attempts.map((a) => (
                    <Tr key={a.id}>
                      <Td className="whitespace-nowrap text-xs">{formatDateTime(a.createdAt, fmt)}</Td>
                      <Td className="font-mono text-xs">{a.ip ?? "—"}</Td>
                      <Td>{a.success ? <Badge tone="green">{t("adm.security.success")}</Badge> : <Badge tone="red">{t("adm.security.failure")}</Badge>}</Td>
                      <Td className="text-xs">{a.reason ?? ""}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={t("adm.users.account")}>
            <DescriptionList items={[
              { label: t("common.status"), value: <Badge status={user.status}>{t(`adm.status.${user.status}`)}</Badge> },
              { label: t("adm.users.username"), value: user.username },
              { label: t("adm.users.created"), value: formatDateTime(user.createdAt, fmt) },
              { label: t("adm.users.lastLogin"), value: user.lastLoginAt ? formatDateTime(user.lastLoginAt, fmt) : t("adm.users.never") },
              { label: t("adm.users.passwordChanged"), value: user.passwordChangedAt ? formatDateTime(user.passwordChangedAt, fmt) : "—" },
              { label: t("adm.users.failedLogins"), value: String(user.failedLoginCount) },
            ]} />
          </Card>

          <Card title={t("adm.users.security")}>
            <div className="space-y-4">
              <div className="space-y-2">
                {locked ? (
                  <Alert tone="warn">{t("adm.users.lockedUntil", { date: formatDateTime(user.lockedUntil, fmt) })}</Alert>
                ) : (
                  <p className="text-sm text-slate-600 dark:text-slate-300">{t("adm.users.notLocked")}</p>
                )}
                {manage && (locked || user.failedLoginCount > 0) && <InlineAction action={unlockUserAction} label={t("adm.users.unlock")} hidden={{ id: user.id }} />}
              </div>

              {canReset && (
                <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                  <h3 className="text-sm font-medium">{user.status === "INVITED" ? t("adm.users.resendInvite") : t("adm.users.resetLink")}</h3>
                  <p className="text-xs text-slate-500">{t("adm.users.resetHint")}</p>
                  <ResultForm action={sendResetLinkAction} dict={dict} labels={resultLabels(t)} confirm={t("adm.users.resetConfirm")}>
                    <input type="hidden" name="id" value={user.id} />
                    {user.status !== "INVITED" && <Checkbox name="forceChange" label={t("adm.users.forceChange")} />}
                    <SubmitButton variant="secondary">{t("adm.users.generateLink")}</SubmitButton>
                  </ResultForm>
                  {user.status === "ACTIVE" && (
                    <InlineAction
                      action={forcePasswordChangeAction}
                      label={user.mustChangePassword ? t("adm.users.cancelForce") : t("adm.users.forceChangeNow")}
                      hidden={{ id: user.id, value: user.mustChangePassword ? "false" : "true" }}
                    />
                  )}
                  {user.mustChangePassword && <p className="text-xs text-amber-700 dark:text-amber-400">{t("adm.users.mustChange")}</p>}
                </div>
              )}

              <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                <h3 className="text-sm font-medium">{t("adm.users.mfa")}</h3>
                <p className="text-sm">{user.mfaEnabled ? <Badge tone="green">{t("adm.users.mfaOn")}</Badge> : <Badge>{t("adm.users.mfaOff")}</Badge>}
                  {user.mfaEnabled && <span className="ml-2 text-xs text-slate-500">{t("adm.users.recoveryLeft", { n: user.mfaRecoveryCodes.length })}</span>}
                </p>
                {canMfa && user.mfaEnabled && (
                  <>
                    <ReauthCard ok={reauthOk} t={t} />
                    <InlineAction action={resetMfaAction} label={t("adm.users.resetMfa")} variant="danger" confirm={t("adm.users.resetMfaConfirm")} hidden={{ id: user.id }} />
                  </>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
