'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { useSubmit } from '@/components/auth/use-submit';
import { useCan } from '@/components/shell/session-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { TextareaField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icons';
import { fullName } from '@/lib/format';
import { useReactivateUser, useSuspendUser } from '@/lib/queries';
import { type StatusReasonDto, type UserProfile, statusReasonSchema } from '@/lib/schemas';

const SUSPENDABLE = new Set<UserProfile['status']>(['ACTIVE', 'PENDING_VERIFICATION']);
const REACTIVATABLE = new Set<UserProfile['status']>(['SUSPENDED', 'LOCKED', 'DEACTIVATED']);

type StatusAction = 'suspend' | 'reactivate';

/**
 * Suspend / reactivate controls shared by the users table and the detail page. Both endpoints
 * are guarded by `users:suspend` and both take a reason, which the API stores on the audit row,
 * so a single dialog serves the two actions.
 */
export function UserStatusActions({
  user,
  size = 'sm',
}: {
  user: UserProfile;
  size?: 'xs' | 'sm' | 'md';
  /** Kept for call-site compatibility; errors are shown inside the dialog. */
  onError?: (message: string) => void;
}) {
  const canSuspend = useCan('users:suspend');
  const [action, setAction] = useState<StatusAction | null>(null);

  if (!canSuspend) return null;

  const available: StatusAction | null = SUSPENDABLE.has(user.status)
    ? 'suspend'
    : REACTIVATABLE.has(user.status)
      ? 'reactivate'
      : null;
  if (!available) return null;

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        onClick={() => setAction(available)}
        leadingIcon={<Icon name={available === 'suspend' ? 'ban' : 'play'} className="h-4 w-4" />}
      >
        {available === 'suspend' ? 'Suspend' : 'Reactivate'}
      </Button>
      {action ? (
        <StatusReasonDialog user={user} action={action} onClose={() => setAction(null)} />
      ) : null}
    </>
  );
}

const COPY: Record<
  StatusAction,
  { title: (name: string) => string; description: string; submit: string; busy: string }
> = {
  suspend: {
    title: (name) => `Suspend ${name}`,
    description:
      'The account is blocked from signing in and its sessions are revoked until an administrator reactivates it.',
    submit: 'Suspend account',
    busy: 'Suspending',
  },
  reactivate: {
    title: (name) => `Reactivate ${name}`,
    description: 'The account can sign in again. Failed-login lockouts are cleared as well.',
    submit: 'Reactivate account',
    busy: 'Reactivating',
  },
};

function StatusReasonDialog({
  user,
  action,
  onClose,
}: {
  user: UserProfile;
  action: StatusAction;
  onClose: () => void;
}) {
  const suspend = useSuspendUser();
  const reactivate = useReactivateUser();
  const copy = COPY[action];
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<StatusReasonDto>({
    resolver: zodResolver(statusReasonSchema),
    defaultValues: { reason: '' },
  });
  const { run, formError, submitting } = useSubmit<StatusReasonDto>(setError);

  const onSubmit = handleSubmit(async (dto) => {
    const result = await run(
      () =>
        action === 'suspend'
          ? suspend.mutateAsync({ id: user.id, dto })
          : reactivate.mutateAsync({ id: user.id, dto }),
      ['reason'],
    );
    if (result) onClose();
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={copy.title(fullName(user) || user.email)}
      description={copy.description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action === 'suspend' ? 'danger' : 'primary'}
            form="status-reason-form"
            type="submit"
            loading={submitting}
            loadingLabel={copy.busy}
          >
            {copy.submit}
          </Button>
        </>
      }
    >
      <form id="status-reason-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <TextareaField
          label="Reason"
          hint="Recorded in the audit log and visible to other administrators."
          rows={3}
          className="font-sans text-sm"
          error={errors.reason?.message}
          {...register('reason')}
        />
      </form>
    </Dialog>
  );
}
