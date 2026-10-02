import "server-only";
import { db } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";

/** Sensitive administrative actions require a password confirmation within this window. */
export const REAUTH_WINDOW_MINUTES = 10;
export const REAUTH_REQUIRED_MESSAGE = "Please confirm your password to continue.";

export async function hasRecentReauth(ctx: Pick<AuthContext, "sessionId" | "user">): Promise<boolean> {
  if (!ctx.sessionId) return false;
  const s = await db.session.findUnique({
    where: { id: ctx.sessionId },
    select: { userId: true, reauthAt: true, revokedAt: true, expiresAt: true },
  });
  if (!s || s.userId !== ctx.user.id || s.revokedAt || s.expiresAt < new Date() || !s.reauthAt) return false;
  return Date.now() - s.reauthAt.getTime() <= REAUTH_WINDOW_MINUTES * 60_000;
}

/** Throws unless the current session confirmed the password within the last 10 minutes. */
export async function requireRecentReauth(ctx: Pick<AuthContext, "sessionId" | "user">): Promise<void> {
  if (!(await hasRecentReauth(ctx))) throw new BusinessError(REAUTH_REQUIRED_MESSAGE);
}
