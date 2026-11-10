import type { Metadata } from 'next';

import { MfaEnrol } from '@/components/admin/mfa-enrol';
import {
  ActionForm,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  FormMessage,
  Input,
  PageHeader,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { listSessions } from '@/server/auth';
import { getPageContext, getSession } from '@/server/auth/session';
import { ROLE_LABELS, STAFF_ROLES } from '@/server/rbac';

import {
  beginMfaAction,
  changePasswordAction,
  confirmMfaAction,
  disableMfaAction,
} from './actions';

export const metadata: Metadata = { title: 'My security' };

/** The signed-in staff member's own password, two-factor authentication and sessions. */
export default async function SecurityPage() {
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const [sessions, current] = await Promise.all([listSessions(ctx), getSession()]);

  return (
    <>
      <PageHeader
        title="My security"
        description="Your own sign-in settings. Back-office accounts should always use two-factor authentication."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Name', value: user.fullName },
                { label: 'E-mail', value: user.email },
                { label: 'Role', value: ROLE_LABELS[user.role] },
                {
                  label: 'Two-factor',
                  value: (
                    <Badge tone={user.mfaEnabled ? 'success' : 'warning'}>
                      {user.mfaEnabled ? 'On' : 'Off'}
                    </Badge>
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Two-factor authentication"
            description={
              user.mfaEnabled
                ? 'A code from your authenticator app is required at every sign-in.'
                : 'Not enabled yet.'
            }
          />
          <CardBody>
            {user.mfaEnabled ? (
              <ActionForm action={disableMfaAction} className="space-y-3" autoComplete="off">
                <Input
                  name="password"
                  type="password"
                  label="Your password"
                  required
                  autoComplete="current-password"
                />
                <Input
                  name="code"
                  label="Current 6-digit code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                />
                <FormMessage />
                <SubmitButton size="sm" variant="danger" pendingLabel="Turning off…">
                  Turn off two-factor
                </SubmitButton>
              </ActionForm>
            ) : (
              <MfaEnrol beginAction={beginMfaAction} confirmAction={confirmMfaAction} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Change password"
            description="At least 10 characters with letters and digits. Your other sessions are signed out."
          />
          <CardBody>
            <ActionForm action={changePasswordAction} className="space-y-3">
              <Input
                name="currentPassword"
                type="password"
                label="Current password"
                required
                autoComplete="current-password"
              />
              <Input
                name="newPassword"
                type="password"
                label="New password"
                required
                minLength={10}
                autoComplete="new-password"
              />
              <Input
                name="confirmPassword"
                type="password"
                label="Repeat the new password"
                required
                minLength={10}
                autoComplete="new-password"
              />
              <FormMessage />
              <SubmitButton size="sm" pendingLabel="Saving…">
                Change password
              </SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Active sessions" description="Where you are signed in" />
          <Table caption="Active sessions">
            <THead>
              <Tr>
                <Th>Started</Th>
                <Th>Device</Th>
                <Th>IP</Th>
                <Th>Expires</Th>
              </Tr>
            </THead>
            <TBody>
              {sessions.map((session) => (
                <Tr key={session.id}>
                  <Td className="whitespace-nowrap">
                    {formatRelative(session.createdAt)}
                    {session.id === current?.sessionId ? (
                      <Badge tone="brand" className="ml-1.5">
                        This session
                      </Badge>
                    ) : null}
                  </Td>
                  <Td
                    className="max-w-48 truncate text-fg-muted"
                    title={session.userAgent ?? undefined}
                  >
                    {session.userAgent ?? 'Unknown'}
                  </Td>
                  <Td className="font-mono text-xs">{session.ip ?? '—'}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(session.expiresAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
