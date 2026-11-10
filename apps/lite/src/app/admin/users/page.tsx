import type { Metadata } from 'next';

import { ActionButton } from '@/components/admin/action-button';
import {
  ActionForm,
  Badge,
  Card,
  CardBody,
  CardHeader,
  FormMessage,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  SubmitButton,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { formatDate, formatRelative } from '@/lib/format';
import { getPageContext, requirePermission } from '@/server/auth/session';
import { type Permission, ROLE_LABELS, ROLE_PERMISSIONS, STAFF_ROLES } from '@/server/rbac';
import { searchUsers } from '@/server/users';

import {
  createStaffUserAction,
  setStaffRoleAction,
  setStaffStatusAction,
  unlockStaffAction,
} from './actions';

export const metadata: Metadata = { title: 'Staff & roles' };

const roleOptions = STAFF_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

/** What each role can change, in plain words (the read set is common to all staff). */
const WRITE_SUMMARY: Record<(typeof STAFF_ROLES)[number], string> = {
  ADMIN: 'Everything: staff, providers, countries, partners, reversals, settings.',
  COMPLIANCE: 'KYC decisions, AML alerts and cases, SARs, screening list, audit log, exports.',
  TREASURY: 'Fees, FX rates, float and thresholds, partner settlements, exports.',
  SUPPORT: 'Read-only on customers and transfers; can refresh a transfer status.',
};

const isWrite = (permission: Permission): boolean =>
  !permission.endsWith(':read') && permission !== 'admin:access';

/** Staff accounts and the role → permission map. Administrators only. */
export default async function StaffPage() {
  await requirePermission('users:write');
  const { ctx, user: viewer } = await getPageContext('ADMIN');
  const lists = await Promise.all(
    STAFF_ROLES.map((role) => searchUsers(ctx, { role, pageSize: 100 })),
  );
  const staff = lists
    .flatMap((list) => list.items)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Staff & roles"
        description="Back-office accounts. A role change or a suspension signs the person out immediately; every change is audited."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Staff accounts" description={`${staff.length} accounts`} />
          <Table caption="Staff accounts">
            <THead>
              <Tr>
                <Th>Person</Th>
                <Th>Role</Th>
                <Th>Security</Th>
                <Th>Status</Th>
                <Th>Last sign-in</Th>
                <Th>Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {staff.map((member) => {
                const self = member.id === viewer.id;
                const locked = member.lockedUntil !== null && member.lockedUntil > now;
                return (
                  <Tr key={member.id} data-staff={member.email}>
                    <Td>
                      <span className="font-medium text-fg">{member.fullName}</span>
                      {self ? <Badge className="ml-1.5">You</Badge> : null}
                      <p className="text-xs text-fg-subtle">{member.email}</p>
                      <p className="text-xs text-fg-subtle">Since {formatDate(member.createdAt)}</p>
                    </Td>
                    <Td>
                      {self ? (
                        ROLE_LABELS[member.role]
                      ) : (
                        <ActionForm
                          action={setStaffRoleAction}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="userId" value={member.id} />
                          <Select
                            name="role"
                            label={`Role of ${member.fullName}`}
                            hideLabel
                            defaultValue={member.role}
                            options={roleOptions}
                            className="h-9 py-1"
                          />
                          <SubmitButton size="sm" variant="ghost">
                            Save<span className="sr-only"> role of {member.fullName}</span>
                          </SubmitButton>
                          <FormMessage className="basis-full text-xs" />
                        </ActionForm>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={member.mfaEnabled ? 'success' : 'warning'}>
                        {member.mfaEnabled ? '2FA on' : '2FA off'}
                      </Badge>
                      {locked ? (
                        <Badge tone="danger" className="ml-1">
                          Locked
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>
                      <StatusBadge status={member.status} />
                    </Td>
                    <Td className="whitespace-nowrap">{formatRelative(member.lastLoginAt)}</Td>
                    <Td className="min-w-48">
                      {self ? (
                        <span className="text-xs text-fg-muted">
                          You cannot change your own role or status.
                        </span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-accent">
                            {member.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                            <span className="sr-only"> {member.fullName}</span>
                          </summary>
                          <ActionForm action={setStaffStatusAction} className="mt-2 space-y-2">
                            <input type="hidden" name="userId" value={member.id} />
                            <input
                              type="hidden"
                              name="status"
                              value={member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}
                            />
                            <Input name="reason" label="Reason" required minLength={5} />
                            <FormMessage />
                            <SubmitButton
                              size="sm"
                              variant={member.status === 'ACTIVE' ? 'danger' : 'primary'}
                            >
                              Confirm
                            </SubmitButton>
                          </ActionForm>
                        </details>
                      )}
                      {locked && !self ? (
                        <ActionButton
                          action={unlockStaffAction}
                          fields={{ userId: member.id }}
                          variant="ghost"
                          className="mt-2 inline-flex flex-col items-start gap-1"
                          showSuccess
                        >
                          Clear lockout
                        </ActionButton>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader
            title="Add a staff account"
            description="The person signs in with this e-mail."
          />
          <CardBody>
            <ActionForm action={createStaffUserAction} className="space-y-3" autoComplete="off">
              <Input name="fullName" label="Full name" required minLength={2} maxLength={120} />
              <Input name="email" type="email" label="Work e-mail" required autoComplete="off" />
              <Select
                name="role"
                label="Role"
                required
                placeholder="Choose a role"
                options={roleOptions}
              />
              <Input
                name="password"
                type="password"
                label="Initial password"
                hint="At least 10 characters with letters and digits. Share it out of band and ask the person to change it and turn on two-factor authentication."
                required
                autoComplete="new-password"
              />
              <FormMessage />
              <SubmitButton pendingLabel="Creating…">Create account</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Roles and permissions"
          description="Fixed in code and enforced on the server for every page, action and export. All staff can read customers, KYC, transfers, providers, partners, fees, FX and reports."
        />
        <Table caption="Roles and permissions">
          <THead>
            <Tr>
              <Th>Role</Th>
              <Th>Can change</Th>
              <Th>Write permissions</Th>
            </Tr>
          </THead>
          <TBody>
            {STAFF_ROLES.map((role) => (
              <Tr key={role}>
                <Td className="font-medium whitespace-nowrap">{ROLE_LABELS[role]}</Td>
                <Td className="max-w-sm text-fg-muted">{WRITE_SUMMARY[role]}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {ROLE_PERMISSIONS[role].filter(isWrite).map((permission) => (
                      <code
                        key={permission}
                        className="rounded bg-surface-muted px-1.5 py-0.5 text-[0.6875rem] text-fg-muted"
                      >
                        {permission}
                      </code>
                    ))}
                  </span>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
