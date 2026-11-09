import { z } from 'zod';

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
} from '../constants/realms.js';
import { createListQuerySchema, isoDateTimeSchema, localeSchema, uuidSchema } from './common.js';

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES);
export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);

export const notificationPreferenceSchema = z.object({
  channel: notificationChannelSchema,
  category: notificationCategorySchema,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

/**
 * Bulk preference update. Each (channel, category) pair may appear once, and SECURITY
 * notifications can never be switched off: they protect the account itself.
 */
export const updateNotificationPreferencesSchema = z
  .object({
    preferences: z
      .array(notificationPreferenceSchema)
      .min(1)
      .max(NOTIFICATION_CHANNELS.length * NOTIFICATION_CATEGORIES.length),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.preferences.forEach((preference, index) => {
      const key = `${preference.channel}:${preference.category}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate preference for ${preference.channel}/${preference.category}`,
          path: ['preferences', index],
        });
      }
      seen.add(key);
      if (preference.category === 'SECURITY' && !preference.enabled) {
        ctx.addIssue({
          code: 'custom',
          message: 'Security notifications cannot be disabled',
          path: ['preferences', index, 'enabled'],
        });
      }
    });
  });
export type UpdateNotificationPreferencesDto = z.infer<typeof updateNotificationPreferencesSchema>;

/** Template keys: dotted lowercase, e.g. `auth.password-reset`, `user.welcome`. */
export const templateKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, { error: 'Invalid template key' })
  .max(100);

/** Template variables are identifiers rendered as `{{variable}}`. */
export const templateVariableSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/);

export const notificationTemplateUpsertSchema = z
  .object({
    key: templateKeySchema,
    channel: notificationChannelSchema,
    locale: localeSchema,
    category: notificationCategorySchema,
    subject: z.string().trim().min(1).max(200).optional(),
    body: z.string().min(1).max(20_000),
    variables: z.array(templateVariableSchema).max(50).default([]),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.channel === 'EMAIL' && !value.subject) {
      ctx.addIssue({
        code: 'custom',
        message: 'Email templates require a subject',
        path: ['subject'],
      });
    }
    if (value.channel === 'SMS' && value.body.length > 1_000) {
      ctx.addIssue({
        code: 'custom',
        message: 'SMS templates must be at most 1000 characters',
        path: ['body'],
      });
    }
    if (new Set(value.variables).size !== value.variables.length) {
      ctx.addIssue({ code: 'custom', message: 'Variables must be unique', path: ['variables'] });
    }
    // Every placeholder used in the template must be declared so renderers can validate payloads.
    const used = new Set<string>();
    for (const match of `${value.subject ?? ''} ${value.body}`.matchAll(
      /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g,
    )) {
      if (match[1]) used.add(match[1]);
    }
    const declared = new Set(value.variables);
    for (const name of used) {
      if (!declared.has(name)) {
        ctx.addIssue({
          code: 'custom',
          message: `Placeholder "${name}" is not declared in variables`,
          path: ['variables'],
        });
      }
    }
  });
export type NotificationTemplateUpsertInput = z.input<typeof notificationTemplateUpsertSchema>;
export type NotificationTemplateUpsertDto = z.infer<typeof notificationTemplateUpsertSchema>;

export const notificationTemplateSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  channel: notificationChannelSchema,
  locale: localeSchema,
  category: notificationCategorySchema,
  subject: z.string().nullable(),
  body: z.string(),
  variables: z.array(z.string()),
  isActive: z.boolean(),
  version: z.number().int().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

export const notificationSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  channel: notificationChannelSchema,
  category: notificationCategorySchema,
  templateKey: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  status: notificationStatusSchema,
  readAt: isoDateTimeSchema.nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type NotificationRecord = z.infer<typeof notificationSchema>;

export const NOTIFICATION_SORTABLE_FIELDS = ['createdAt', 'sentAt', 'status'] as const;

export const listNotificationsQuerySchema = createListQuerySchema(
  NOTIFICATION_SORTABLE_FIELDS,
  'createdAt',
).extend({
  channel: notificationChannelSchema.optional(),
  category: notificationCategorySchema.optional(),
  status: notificationStatusSchema.optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/** Admin-triggered ad-hoc send (e.g. resend a verification email). */
export const sendNotificationSchema = z
  .object({
    userId: uuidSchema,
    templateKey: templateKeySchema,
    channel: notificationChannelSchema,
    variables: z
      .record(templateVariableSchema, z.union([z.string(), z.number(), z.boolean()]))
      .default({}),
  })
  .strict();
export type SendNotificationDto = z.infer<typeof sendNotificationSchema>;
