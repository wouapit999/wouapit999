import { z } from 'zod';

import { AUDIT_OUTCOMES } from '../constants/realms.js';
import { createListQuerySchema, isoDateTimeSchema, uuidSchema } from './common.js';
import { userRealmSchema } from './auth.js';

export const auditOutcomeSchema = z.enum(AUDIT_OUTCOMES);

/** Action names are dotted lowercase identifiers, e.g. `user.create`, `auth.login`. */
export const auditActionSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/, { error: 'Invalid audit action' })
  .max(100);

/** Resource types are the PascalCase entity names from schema v1 (e.g. `User`, `Role`). */
export const auditResourceSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Za-z0-9]*$/, { error: 'Invalid resource type' })
  .max(60);

export const AUDIT_SORTABLE_FIELDS = ['createdAt'] as const;

export const auditLogQuerySchema = createListQuerySchema(AUDIT_SORTABLE_FIELDS, 'createdAt')
  .extend({
    actorId: uuidSchema.optional(),
    actorRealm: userRealmSchema.optional(),
    action: auditActionSchema.optional(),
    resource: auditResourceSchema.optional(),
    resourceId: z.string().trim().min(1).max(128).optional(),
    outcome: auditOutcomeSchema.optional(),
    correlationId: z.string().trim().min(1).max(128).optional(),
    ip: z.string().trim().max(45).optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to), {
    error: 'from must be before to',
    path: ['to'],
  });
export type AuditLogQueryInput = z.input<typeof auditLogQuerySchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogSchema = z.object({
  id: uuidSchema,
  actorId: uuidSchema.nullable(),
  actorEmail: z.string().nullable(),
  actorRealm: userRealmSchema.nullable(),
  /** Set when the actor is a service account (`ApiKey`). */
  apiKeyId: uuidSchema.nullable(),
  action: z.string(),
  resource: z.string(),
  resourceId: z.string().nullable(),
  outcome: auditOutcomeSchema,
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  correlationId: z.string(),
  createdAt: isoDateTimeSchema,
});
export type AuditLogEntry = z.infer<typeof auditLogSchema>;

export const auditExportQuerySchema = auditLogQuerySchema.and(
  z.object({ format: z.enum(['csv', 'json']).default('csv') }),
);
export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;
