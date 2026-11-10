'use server';

import { z } from 'zod';

import { reasonField } from '@/components/admin/helpers';
import { createAction } from '@/lib/server-action';
import { STAFF_ROLES } from '@/server/rbac';
import { createStaffUser, setStaffRole, setUserStatus, unlockUser } from '@/server/users';

const PATH = '/admin/users';

/** Create a back-office account (`users:write`, administrators only). */
export const createStaffUserAction = createAction({
  schema: z.object({
    email: z.string().trim().max(200),
    fullName: z.string().trim().min(2, 'Enter the full name').max(120),
    role: z.enum(STAFF_ROLES, 'Choose a role'),
    password: z.string().max(128),
  }),
  permission: 'users:write',
  handler: async (input, ctx) => {
    const user = await createStaffUser(ctx, input);
    return { email: user.email };
  },
  successMessage: (result) => `Account created for ${result.email}`,
  revalidate: [PATH],
});

/** Change a staff member's role; they are signed out so the new role applies at once. */
export const setStaffRoleAction = createAction({
  schema: z.object({ userId: z.uuid(), role: z.enum(STAFF_ROLES) }),
  permission: 'users:write',
  handler: async (input, ctx) => {
    const user = await setStaffRole(ctx, input.userId, input.role);
    return { email: user.email, role: user.role };
  },
  successMessage: (result) => `${result.email} is now ${result.role.toLowerCase()}`,
  revalidate: [PATH],
});

export const setStaffStatusAction = createAction({
  schema: z.object({
    userId: z.uuid(),
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    reason: reasonField('Give a reason'),
  }),
  permission: 'users:write',
  handler: async (input, ctx) => {
    const user = await setUserStatus(ctx, input.userId, input.status, input.reason);
    return { email: user.email, status: user.status };
  },
  successMessage: (result) =>
    `${result.email} ${result.status === 'ACTIVE' ? 'reactivated' : 'suspended and signed out'}`,
  revalidate: [PATH],
});

export const unlockStaffAction = createAction({
  schema: z.object({ userId: z.uuid() }),
  permission: 'users:write',
  handler: async (input, ctx) => {
    await unlockUser(ctx, input.userId);
  },
  successMessage: 'Lockout cleared',
  revalidate: [PATH],
});
