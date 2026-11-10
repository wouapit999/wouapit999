import { SignJWT, jwtVerify } from 'jose';

import type { Role } from '@/generated/prisma/enums';

import { getEnv } from '../env';

/**
 * Session token: a compact HS256 JWT carrying only identifiers. It is verified (signature +
 * expiry) by the proxy without touching the database; server code then loads the `sessions` row
 * so revocation, suspension and role changes take effect immediately.
 *
 * This module has no Node-only imports besides `jose`, so the proxy can use it.
 */

export const SESSION_COOKIE = 'birem_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const ISSUER = 'bi-rem-lite';
const AUDIENCE = 'bi-rem-lite:session';

export interface SessionTokenPayload {
  /** User id. */
  readonly sub: string;
  /** Session id (`sessions.id`). */
  readonly sid: string;
  readonly role: Role;
  /** Expiry, seconds since the epoch. */
  readonly exp: number;
}

const ROLES: readonly string[] = [
  'CUSTOMER',
  'ADMIN',
  'COMPLIANCE',
  'TREASURY',
  'SUPPORT',
  'PARTNER',
];

const secretKey = (): Uint8Array => new TextEncoder().encode(getEnv().authSecret);

export async function signSessionToken(
  payload: Omit<SessionTokenPayload, 'exp'>,
  expiresAt: Date,
): Promise<string> {
  return new SignJWT({ sid: payload.sid, role: payload.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());
}

/** Returns the payload when the token is authentic and unexpired, otherwise null. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionTokenPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    const { sub, sid, role, exp } = payload;
    if (
      typeof sub !== 'string' ||
      typeof sid !== 'string' ||
      typeof role !== 'string' ||
      typeof exp !== 'number' ||
      !ROLES.includes(role)
    ) {
      return null;
    }
    return { sub, sid, role: role as Role, exp };
  } catch {
    return null;
  }
}
