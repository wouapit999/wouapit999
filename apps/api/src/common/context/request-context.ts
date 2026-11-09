import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthenticatedPrincipal } from '../auth/principal.js';

export interface RequestContextStore {
  correlationId: string;
  /** Authenticated principal, set by the auth guard (or by AuthService after a login). */
  actor?: AuthenticatedPrincipal;
  /** Resource snapshot captured by a service before mutating, consumed by the audit interceptor. */
  auditBefore?: unknown;
  /** Resource snapshot after mutation, when the service wants to override the default (response body). */
  auditAfter?: unknown;
  /** Resource identifier override for the audit record. */
  auditResourceId?: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Request-scoped context backed by AsyncLocalStorage so services deep in the call stack can
 * reach the correlation id and actor without threading them through every signature.
 */
export const RequestContext = {
  run<T>(store: RequestContextStore, callback: () => T): T {
    return storage.run(store, callback);
  },
  current(): RequestContextStore | undefined {
    return storage.getStore();
  },
  correlationId(): string | undefined {
    return storage.getStore()?.correlationId;
  },
  actor(): AuthenticatedPrincipal | undefined {
    return storage.getStore()?.actor;
  },
  setActor(actor: AuthenticatedPrincipal): void {
    const store = storage.getStore();
    if (store) store.actor = actor;
  },
  /** Records the pre-mutation state of the resource being changed for the audit diff. */
  recordBefore(before: unknown): void {
    const store = storage.getStore();
    if (store) store.auditBefore = before;
  },
  recordAfter(after: unknown): void {
    const store = storage.getStore();
    if (store) store.auditAfter = after;
  },
  setResourceId(id: string): void {
    const store = storage.getStore();
    if (store) store.auditResourceId = id;
  },
};
