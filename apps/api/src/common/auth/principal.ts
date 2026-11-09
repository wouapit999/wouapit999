import type { UserRealm } from '@bi-rem/db';

export type PrincipalType = 'USER' | 'API_KEY';

/** Identity attached to `request.user` by the auth guard for both JWT and API-key callers. */
export interface AuthenticatedPrincipal {
  readonly type: PrincipalType;
  /** User id for USER principals, ApiKey id for API_KEY principals. */
  readonly id: string;
  readonly userId: string | null;
  readonly apiKeyId: string | null;
  readonly realm: UserRealm | null;
  readonly email: string | null;
  readonly roles: readonly string[];
  /** Permission keys for users (resolved from roles), scopes for API keys (may include wildcards). */
  readonly permissions: readonly string[];
  /** Refresh-token (session) id the access token was issued for. */
  readonly sessionId: string | null;
}

export interface AuthenticatedRequest {
  user?: AuthenticatedPrincipal;
  /** Per-request memo of the resolved permission set (filled by PermissionsGuard). */
  permissionSet?: ReadonlySet<string>;
}
