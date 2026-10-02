import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { hashToken, randomToken } from "./crypto";

export const SESSION_COOKIE = "rf_session";

export async function requestMeta() {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const userAgent = (h.get("user-agent") ?? "").slice(0, 300);
  const correlationId = h.get("x-correlation-id") ?? h.get("x-vercel-id") ?? randomToken(8);
  return { ip, userAgent, correlationId };
}

/**
 * Creates a session row and sets the cookie. `supportAccessId` binds the session to a
 * controlled support-access grant (platform support acting as an organization administrator);
 * such sessions become invalid as soon as the grant ends or expires.
 */
export async function createSession(
  userId: string,
  opts: { timeoutMinutes: number; mfaPending?: boolean; supportAccessId?: string },
): Promise<{ sessionId: string; expiresAt: Date }> {
  const token = randomToken();
  const meta = await requestMeta();
  const expiresAt = new Date(Date.now() + opts.timeoutMinutes * 60_000);
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      mfaPending: opts.mfaPending ?? false,
      ip: meta.ip,
      userAgent: meta.userAgent,
      reauthAt: new Date(),
      supportAccessId: opts.supportAccessId ?? null,
    },
    select: { id: true },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { sessionId: session.id, expiresAt };
}

/** Returns the live session row (not expired, not revoked) for the current cookie. */
export async function readSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  return session;
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
