'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { markAllNotificationsRead, markNotificationRead } from '@/server/notifications';
import { STAFF_ROLES } from '@/server/rbac';

const PATHS = ['/admin/notifications', '/admin'];

/** Mark one of the signed-in user's own notifications as read. */
export const markNotificationReadAction = createAction({
  schema: z.object({ id: z.uuid() }),
  roles: STAFF_ROLES,
  handler: (input, ctx) => markNotificationRead(ctx, input.id),
  revalidate: PATHS,
});

export const markAllNotificationsReadAction = createAction({
  schema: z.object({}),
  roles: STAFF_ROLES,
  handler: async (_input, ctx) => ({ count: await markAllNotificationsRead(ctx) }),
  successMessage: (result) =>
    result.count === 0 ? 'Nothing to mark' : `${result.count} marked as read`,
  revalidate: PATHS,
});
