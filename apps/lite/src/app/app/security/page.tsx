import type { Metadata } from 'next';

import { MfaSetup } from '@/components/customer/mfa-setup';
import {
  ActionForm,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ConfirmSubmitButton,
  FormActions,
  FormMessage,
  Input,
  PageHeader,
  StatusBadge,
  SubmitButton,
} from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { getProfile, listSessions } from '@/server/auth';
import { getPageContext, getSession } from '@/server/auth/session';

import { describeUserAgent } from '../_lib/user-agent';
import {
  changePasswordAction,
  disableMfaAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
} from './actions';

export const metadata: Metadata = { title: 'Security' };

/** Password, TOTP two-factor authentication and active sessions of the signed-in customer. */
export default async function SecurityPage() {
  const { ctx } = await getPageContext('CUSTOMER');
  const [profile, sessions, current] = await Promise.all([
    getProfile(ctx),
    listSessions(ctx),
    getSession(),
  ]);
  const others = sessions.filter((session) => session.id !== current?.sessionId);

  return (
    <>
      <PageHeader
        title="Security"
        description="Your password, two-factor authentication and the devices signed in to your account."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <Card>
          <CardHeader title="Password" description="Changing it signs out every other device." />
          <CardBody>
            <ActionForm action={changePasswordAction} className="space-y-4">
              <Input
                name="currentPassword"
                type="password"
                label="Current password"
                autoComplete="current-password"
                required
              />
              <Input
                name="newPassword"
                type="password"
                label="New password"
                autoComplete="new-password"
                required
                minLength={10}
                hint="At least 10 characters, with a letter and a digit"
              />
              <Input
                name="confirmPassword"
                type="password"
                label="Confirm the new password"
                autoComplete="new-password"
                required
              />
              <FormMessage />
              <FormActions>
                <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
              </FormActions>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Two-factor authentication"
            description="A 6-digit code from an authenticator app, on top of your password."
            action={
              <StatusBadge
                status={profile.mfaEnabled ? 'ACTIVE' : 'INACTIVE'}
                label={profile.mfaEnabled ? 'On' : 'Off'}
              />
            }
          />
          <CardBody>
            {profile.mfaEnabled ? (
              <ActionForm action={disableMfaAction} className="space-y-4">
                <p className="text-sm text-fg-muted">
                  Two-factor authentication is on
                  {profile.mfaEnabledAt ? ` since ${formatDate(profile.mfaEnabledAt)}` : ''}. To
                  turn it off, confirm your password and a current code.
                </p>
                <Input
                  name="password"
                  type="password"
                  label="Password"
                  autoComplete="current-password"
                  required
                />
                <Input
                  name="code"
                  label="Authentication code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,7}"
                  maxLength={7}
                  placeholder="123 456"
                  required
                  containerClassName="max-w-xs"
                />
                <FormMessage />
                <FormActions>
                  <ConfirmSubmitButton
                    variant="danger"
                    confirm="Turn off two-factor authentication?"
                    pendingLabel="Turning off…"
                  >
                    Turn off two-factor
                  </ConfirmSubmitButton>
                </FormActions>
              </ActionForm>
            ) : (
              <MfaSetup />
            )}
            <p className="mt-4 text-xs text-fg-subtle">
              BI-Rem Lite has no recovery codes: if you lose your authenticator, support has to
              verify you before two-factor can be reset.
            </p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Active sessions"
            description="Every device currently signed in. Sessions end by themselves after 12 hours."
            action={
              others.length > 0 ? (
                <ActionForm action={revokeOtherSessionsAction}>
                  <ConfirmSubmitButton
                    variant="secondary"
                    size="sm"
                    confirm="Sign out every other device?"
                    pendingLabel="Signing out…"
                  >
                    Sign out all other sessions
                  </ConfirmSubmitButton>
                </ActionForm>
              ) : null
            }
          />
          <ul aria-label="Active sessions" className="divide-y divide-border">
            {sessions.map((session) => {
              const isCurrent = session.id === current?.sessionId;
              return (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                      {describeUserAgent(session.userAgent)}
                      {isCurrent ? <Badge tone="brand">This device</Badge> : null}
                      {session.mfaVerified ? <Badge tone="success">Two-factor</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {session.ip ? `IP ${session.ip} · ` : ''}signed in{' '}
                      {formatDateTime(session.createdAt)} · expires{' '}
                      {formatDateTime(session.expiresAt)}
                    </p>
                  </div>
                  {isCurrent ? null : (
                    <ActionForm action={revokeSessionAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={session.id} />
                      <FormMessage showSuccess={false} />
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Signing out…">
                        Sign out
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
