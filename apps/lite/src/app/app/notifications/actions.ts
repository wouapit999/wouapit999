'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { markAllNotificationsRead, markNotificationRead } from '@/server/notifications';

/** Both actions are scoped by the service to the signed-in user's own notifications. */

export const markNotificationReadAction = createAction({
  schema: z.object({ id: z.uuid() }),
  roles: ['CUSTOMER'],
  handler: (input, ctx) => markNotificationRead(ctx, input.id),
  revalidate: ['/app/notifications', '/app'],
});

export const markAllNotificationsReadAction = createAction({
  schema: z.object({}),
  roles: ['CUSTOMER'],
  handler: (_input, ctx) => markAllNotificationsRead(ctx),
  successMessage: (count) =>
    count === 0
      ? 'Nothing left to mark.'
      : `${count} notification${count === 1 ? '' : 's'} marked as read.`,
  revalidate: ['/app/notifications', '/app'],
});
