import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/i18n";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { ResultForm } from "@/components/admin/result-form";
import { Alert, Badge, Card, Input, LinkButton, PageHeader, Select, Table, Td, Th, Tr } from "@/components/ui";
import { ACCOUNT_DICT_KEYS, accountMessages } from "./messages";
import {
  disableMfaAction,
  regenerateRecoveryCodesAction,
  revokeMyOtherSessionsAction,
  revokeMySessionAction,
  startMfaEnrollmentAction,
  updateMyProfileAction,
  verifyMfaEnrollmentAction,
} from "./actions";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const ctx = await requireContext();
  const { t } = await getT(accountMessages);
  const now = new Date();
  const [user, sessions, attempts, settings] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: { name: true, email: true, phone: true, locale: true, mfaEnabled: true, mfaSecret: true, mfaRecoveryCodes: true, passwordChangedAt: true },
    }),
    db.session.findMany({ where: { userId: ctx.user.id, revokedAt: null, expiresAt: { gt: now } }, orderBy: { lastSeenAt: "desc" }, take: 20, select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true } }),
    db.loginAttempt.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, createdAt: true, ip: true, success: true, reason: true } }),
    ctx.organizationId ? getOrgSettings(ctx.organizationId) : Promise.resolve(null),
  ]);
  const fmt = { timezone: settings?.timezone ?? "UTC", dateFormat: settings?.dateFormat };
  const dict = Object.fromEntries(ACCOUNT_DICT_KEYS.map((k) => [k, t(k)]));
  const labels = { secret: t("acct.mfa.secret"), uri: t("acct.mfa.uri"), codes: t("acct.mfa.codes"), once: t("acct.once"), copy: t("acct.copy"), copied: t("acct.copied") };
  const pending = !user.mfaEnabled && Boolean(user.mfaSecret);

  return (
    <>
      <PageHeader title={t("acct.title")} description={t("acct.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("acct.profile")}>
          <ActionForm action={updateMyProfileAction} dict={dict}>
            <Input label={t("common.email")} name="email_ro" defaultValue={user.email} disabled />
            <Input label={t("common.name")} name="name" defaultValue={user.name} required maxLength={120} />
            <Input label={t("common.phone")} name="phone" type="tel" defaultValue={user.phone ?? ""} maxLength={40} />
            <Select label={t("common.language")} name="locale" defaultValue={user.locale ?? settings?.defaultLanguage ?? "fr"} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} />
            <SubmitButton>{t("common.save")}</SubmitButton>
          </ActionForm>
        </Card>

        <div className="space-y-6">
          <Card title={t("acct.password")}>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("acct.passwordHint")}</p>
            {user.passwordChangedAt && <p className="mb-3 text-xs text-slate-500">{formatDateTime(user.passwordChangedAt, fmt)}</p>}
            <LinkButton href="/change-password" variant="secondary">{t("acct.changePassword")}</LinkButton>
          </Card>

          <Card title={t("acct.mfa.title")} actions={user.mfaEnabled ? <Badge tone="green">{t("acct.mfa.on")}</Badge> : <Badge>{t("acct.mfa.off")}</Badge>}>
            {!user.mfaEnabled ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-300">{t("acct.mfa.intro")}</p>
                {pending && <Alert tone="info">{t("acct.mfa.pending")}</Alert>}
                <ResultForm action={startMfaEnrollmentAction} dict={dict} labels={labels}>
                  <SubmitButton variant={pending ? "secondary" : "primary"}>{pending ? t("acct.mfa.restart") : t("acct.mfa.start")}</SubmitButton>
                </ResultForm>
                {pending && (
                  <ResultForm action={verifyMfaEnrollmentAction} dict={dict} labels={labels}>
                    <Input label={t("acct.mfa.code")} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required wrapperClassName="max-w-40" />
                    <SubmitButton>{t("acct.mfa.verify")}</SubmitButton>
                  </ResultForm>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm">{t("acct.mfa.codesLeft", { n: user.mfaRecoveryCodes.length })}</p>
                <ResultForm action={regenerateRecoveryCodesAction} dict={dict} labels={labels} resetOnSuccess>
                  <Input label={t("auth.currentPassword")} name="password" type="password" autoComplete="current-password" required wrapperClassName="max-w-sm" />
                  <SubmitButton variant="secondary">{t("acct.mfa.regenerate")}</SubmitButton>
                </ResultForm>
                <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                  <ActionForm action={disableMfaAction} dict={dict} confirm={t("acct.mfa.disableConfirm")} resetOnSuccess>
                    <Input label={t("auth.currentPassword")} name="password" type="password" autoComplete="current-password" required wrapperClassName="max-w-sm" hint={t("acct.mfa.passwordRequired")} />
                    <SubmitButton variant="danger">{t("acct.mfa.disable")}</SubmitButton>
                  </ActionForm>
                </div>
              </div>
            )}
          </Card>
        </div>

        <Card title={t("acct.sessions.title")} className="lg:col-span-2" actions={sessions.length > 1 && <InlineAction action={revokeMyOtherSessionsAction} label={t("acct.sessions.revokeOthers")} variant="danger" />}>
          <Table>
            <thead><tr><Th>{t("acct.sessions.started")}</Th><Th>{t("acct.sessions.lastSeen")}</Th><Th>IP</Th><Th>{t("acct.sessions.device")}</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sessions.map((s) => (
                <Tr key={s.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(s.createdAt, fmt)}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(s.lastSeenAt, fmt)}</Td>
                  <Td className="font-mono text-xs">{s.ip ?? "—"}</Td>
                  <Td className="max-w-xs truncate text-xs">{s.userAgent || "—"}</Td>
                  <Td>{s.id === ctx.sessionId ? <Badge tone="blue">{t("acct.sessions.current")}</Badge> : <InlineAction action={revokeMySessionAction} label={t("acct.sessions.revoke")} hidden={{ sessionId: s.id }} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title={t("acct.history")} className="lg:col-span-2">
          {attempts.length === 0 ? (
            <p className="text-sm text-slate-500">{t("common.empty")}</p>
          ) : (
            <Table>
              <thead><tr><Th>{t("common.date")}</Th><Th>IP</Th><Th>{t("common.status")}</Th><Th>{t("common.reason")}</Th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {attempts.map((a) => (
                  <Tr key={a.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(a.createdAt, fmt)}</Td>
                    <Td className="font-mono text-xs">{a.ip ?? "—"}</Td>
                    <Td>{a.success ? <Badge tone="green">{t("acct.success")}</Badge> : <Badge tone="red">{t("acct.failure")}</Badge>}</Td>
                    <Td className="text-xs">{a.reason ?? ""}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
