import { type DbOrTx, type Prisma, db } from './db';
import { AppError } from './errors';
import { type ActionContext, requireUserActor } from './rbac';

/**
 * In-app notifications (the only channel in Lite — SMS / e-mail / push are roadmap items).
 * Written inline, inside the same transaction as the event that triggers them.
 */

export interface NotificationInput {
  readonly userId: string;
  /** Machine type, e.g. `transfer.completed`, `kyc.approved`. */
  readonly type: string;
  readonly title: string;
  readonly body: string;
  /** In-app link, e.g. `/app/transfers/<id>`. */
  readonly href?: string;
  readonly data?: Prisma.InputJsonValue;
  /** Backdating for the demo seed only. */
  readonly at?: Date;
}

export async function notify(client: DbOrTx, input: NotificationInput): Promise<void> {
  await client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      data: input.data,
      ...(input.at ? { createdAt: input.at } : {}),
    },
  });
}

/** Notifies every active user holding one of `roles` (e.g. compliance on a new AML case). */
export async function notifyRoles(
  client: DbOrTx,
  roles: ReadonlyArray<'ADMIN' | 'COMPLIANCE' | 'TREASURY' | 'SUPPORT'>,
  input: Omit<NotificationInput, 'userId'>,
): Promise<void> {
  const users = await client.user.findMany({
    where: { role: { in: [...roles] }, status: 'ACTIVE' },
    select: { id: true },
  });
  if (users.length === 0) return;
  await client.notification.createMany({
    data: users.map((user) => ({
      userId: user.id,
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      data: input.data,
      ...(input.at ? { createdAt: input.at } : {}),
    })),
  });
}

/** The signed-in user's notifications, newest first. */
export async function listNotifications(
  ctx: ActionContext,
  options: { unreadOnly?: boolean; limit?: number } = {},
) {
  const actor = requireUserActor(ctx);
  return db.notification.findMany({
    where: { userId: actor.id, ...(options.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 50, 200),
  });
}

export async function countUnreadNotifications(ctx: ActionContext): Promise<number> {
  const actor = requireUserActor(ctx);
  return db.notification.count({ where: { userId: actor.id, readAt: null } });
}

/** Marks one notification read; a user can only touch their own. */
export async function markNotificationRead(ctx: ActionContext, id: string): Promise<void> {
  const actor = requireUserActor(ctx);
  const result = await db.notification.updateMany({
    where: { id, userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    const exists = await db.notification.count({ where: { id, userId: actor.id } });
    if (exists === 0) throw new AppError('NOT_FOUND', 'Notification not found');
  }
}

export async function markAllNotificationsRead(ctx: ActionContext): Promise<number> {
  const actor = requireUserActor(ctx);
  const result = await db.notification.updateMany({
    where: { userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
