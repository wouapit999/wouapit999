import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'bi-rem:audit';
export const AUDIT_SKIP_KEY = 'bi-rem:auditSkip';

export interface AuditOptions {
  /** Dotted action name, e.g. `users.update`. Defaults to `<controller>.<handler>`. */
  action?: string;
  /** PascalCase resource type, e.g. `User`. Defaults to the controller's resource. */
  resource?: string;
  /** Name of the route param carrying the resource id (default `id`). */
  idParam?: string;
}

/** Overrides the audit action/resource derived from the controller and handler names. */
export const Audit = (actionOrOptions: string | AuditOptions) =>
  SetMetadata(
    AUDIT_KEY,
    typeof actionOrOptions === 'string' ? { action: actionOrOptions } : actionOrOptions,
  );

/** Excludes a mutating route from audit logging (use sparingly, e.g. health probes). */
export const SkipAudit = () => SetMetadata(AUDIT_SKIP_KEY, true);
