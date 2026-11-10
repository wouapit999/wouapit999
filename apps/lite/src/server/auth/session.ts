import 'server-only';

import { randomUUID } from 'node:crypto';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import type { Role } from '@/generated/prisma/enums';

import { getEnv } from '../env';
import { AppError } from '../errors';
import { type ActionContext, type Permission, homePathForRole, roleHasPermission } from '../rbac';
import {
  type RequestMeta,
  type ResolvedSession,
  type SessionUser,
  logout,
  resolveSession,
} from './service';
import { SESSION_COOKIE } from './token';

/**
 * Next.js-bound session helpers: the `birem_session` cookie (httpOnly, SameSite=Lax, Secure in
 * production) and guards for pages (`require*` → redirect) and actions (`getActionContext` →
 * throws). Server-only.
 */

export { SESSION_COOKIE };

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getEnv().nodeEnv === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** IP, user agent and correlation id of the current request. */
export async function getRequestMeta(): Promise<Required<RequestMeta>> {
  const list = await headers();
  const forwarded = list.get('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    ip: forwarded ?? list.get('x-real-ip') ?? null,
    userAgent: list.get('user-agent'),
    requestId: list.get('x-request-id') ?? randomUUID(),
  };
}

/** The live session of the current request (memoised per request), or null. */
export const getSession = cache(async (): Promise<ResolvedSession | null> => {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
});

/** The signed-in user, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  return (await getSession())?.user ?? null;
}

/** Pages/layouts: the signed-in user, or a redirect to `/login`. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session.user;
}

/** Pages/layouts: requires one of `roles`; other roles are sent to their own area. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homePathForRole(user.role));
  return user;
}

/** Pages: requires a permission; users without it are sent to their own area. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!roleHasPermission(user.role, permission)) redirect(homePathForRole(user.role));
  return user;
}

function contextFromSession(session: ResolvedSession, meta: RequestMeta): ActionContext {
  return {
    actor: {
      type: 'USER',
      id: session.user.id,
      role: session.user.role,
      label: session.user.email,
      partnerId: session.user.partnerId,
    },
    ...meta,
  };
}

/**
 * Server actions / route handlers: the `ActionContext` for the signed-in user.
 * Throws `UNAUTHENTICATED` (never redirects) so callers can map it to form state or a 401.
 */
export async function getActionContext(): Promise<ActionContext> {
  const session = await getSession();
  if (!session)
    throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  return contextFromSession(session, await getRequestMeta());
}

/**
 * Pages and layouts: the signed-in user plus the `ActionContext` to pass to service functions.
 * Redirects to `/login` when signed out and, when `roles` are given, sends other roles to
 * their own area.
 */
export async function getPageContext(
  ...roles: Role[]
): Promise<{ ctx: ActionContext; user: SessionUser }> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (roles.length > 0 && !roles.includes(session.user.role))
    redirect(homePathForRole(session.user.role));
  return { ctx: contextFromSession(session, await getRequestMeta()), user: session.user };
}

/** Revokes the current session and clears the cookie. */
export async function endSession(): Promise<void> {
  const session = await getSession();
  if (session) {
    await logout(session.sessionId, contextFromSession(session, await getRequestMeta()));
  }
  await clearSessionCookie();
}
