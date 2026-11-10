import { writeAudit } from '../audit';
import { db } from '../db';
import { AppError } from '../errors';
import { type ActionContext, requireUserActor } from '../rbac';

/**
 * Self-service session management for the security pages: a signed-in user may end any of
 * their OWN sessions. (`logout` in `service.ts` revokes by id without an ownership check, so it
 * must never be called with an id that came from the browser.)
 *
 * Import from '@/server/auth/own-sessions' (not re-exported by the auth index).
 */

/** Ends one session of the signed-in user. NOT_FOUND for a session of anybody else. */
export async function revokeOwnSession(ctx: ActionContext, sessionId: string): Promise<void> {
  const actor = requireUserActor(ctx);
  await db.$transaction(async (tx) => {
    const result = await tx.session.updateMany({
      where: { id: sessionId, userId: actor.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw new AppError('NOT_FOUND', 'Session not found');
    await writeAudit(tx, ctx, {
      action: 'auth.session.revoke',
      resourceType: 'session',
      resourceId: sessionId,
    });
  });
}

/** Ends every session of the signed-in user except `keepSessionId`. Returns how many ended. */
export async function revokeOtherOwnSessions(
  ctx: ActionContext,
  keepSessionId: string,
): Promise<number> {
  const actor = requireUserActor(ctx);
  return db.$transaction(async (tx) => {
    const result = await tx.session.updateMany({
      where: { userId: actor.id, revokedAt: null, id: { not: keepSessionId } },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      await writeAudit(tx, ctx, {
        action: 'auth.session.revoke_others',
        resourceType: 'user',
        resourceId: actor.id,
        metadata: { revoked: result.count },
      });
    }
    return result.count;
  });
}
