import type { Metadata } from 'next';

import { PartnerActionButton } from '@/components/partner/action-button';
import { PartnerMfaEnrol } from '@/components/partner/mfa-enrol';
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
  StatusBadge,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatBps, formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { listSessions } from '@/server/auth';
import { getSession } from '@/server/auth/session';

import { PARTNER_TYPE_LABELS, getPartnerPage } from '../_lib/partner';
import {
  beginMfaAction,
  changePasswordAction,
  confirmMfaAction,
  disableMfaAction,
  signOutOtherSessionsAction,
} from './actions';

export const metadata: Metadata = { title: 'Profile & security' };

/** The partner's registered details (read-only) and the signed-in user's own sign-in settings. */
export default async function PartnerProfilePage() {
  const { ctx, user, partner } = await getPartnerPage();
  const [sessions, current] = await Promise.all([listSessions(ctx), getSession()]);

  return (
    <>
      <PageHeader
        title="Profile & security"
        description="Your business details as registered with BI-Rem, and the security of this login."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Business" action={<StatusBadge status={partner.status} />} />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Name', value: partner.name },
                ...(partner.legalName ? [{ label: 'Legal name', value: partner.legalName }] : []),
                { label: 'Type', value: PARTNER_TYPE_LABELS[partner.type] },
                {
                  label: 'Payment code',
                  value: <code className="font-mono font-medium">{partner.code}</code>,
                },
                {
                  label: 'Country · currency',
                  value: `${partner.countryCode} · ${partner.currency}`,
                },
                { label: 'Commission rate', value: formatBps(partner.commissionBps) },
                { label: 'Contact e-mail', value: partner.contactEmail },
                ...(partner.contactPhone
                  ? [{ label: 'Contact phone', value: partner.contactPhone }]
                  : []),
                ...(partner.website ? [{ label: 'Website', value: partner.website }] : []),
                {
                  label: partner.approvedAt ? 'Approved' : 'Applied',
                  value: formatDate(partner.approvedAt ?? partner.createdAt),
                },
              ]}
            />
            <p className="mt-4 text-xs text-fg-muted">
              Business details and the commission rate are set by BI-Rem. Contact support to change
              them.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Your login" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Name', value: user.fullName },
                { label: 'E-mail', value: user.email },
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
              <PartnerMfaEnrol beginAction={beginMfaAction} confirmAction={confirmMfaAction} />
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

        <Card className="lg:col-span-2">
          <CardHeader
            title="Active sessions"
            description="Where this login is signed in"
            action={
              sessions.length > 1 ? (
                <PartnerActionButton
                  action={signOutOtherSessionsAction}
                  fields={{}}
                  confirm="Sign out every other session of this login?"
                  showSuccess
                >
                  Sign out other sessions
                </PartnerActionButton>
              ) : undefined
            }
          />
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
                  <Td>
                    <span
                      className="block max-w-72 truncate text-fg-muted"
                      title={session.userAgent ?? undefined}
                    >
                      {session.userAgent ?? 'Unknown'}
                    </span>
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
