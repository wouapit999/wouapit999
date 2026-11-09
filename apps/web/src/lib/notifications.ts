import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from '@bi-rem/shared/constants';
import { buildPaginationMeta, paginationMetaSchema, uuidSchema } from '@bi-rem/shared/schemas';
import { z } from 'zod';

/**
 * Wire format of `GET /v1/notifications/me`.
 *
 * The API returns the stored `Notification` row: the rendered message lives in
 * `payload.{subject,body}` and there is no `category` column (templates carry it). The shared
 * `notificationSchema` describes the flattened read model that later phases will expose; this
 * schema accepts both shapes and normalises them so the UI has a single type to render.
 */
const isoDateTime = z.iso.datetime({ offset: true });

const channelSchema = z.enum(NOTIFICATION_CHANNELS);
const categorySchema = z.enum(NOTIFICATION_CATEGORIES);

const payloadSchema = z.looseObject({
  subject: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
});

export const notificationWireSchema = z
  .looseObject({
    id: uuidSchema,
    channel: channelSchema,
    templateKey: z.string().nullable().optional(),
    category: categorySchema.nullable().optional(),
    subject: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    payload: payloadSchema.nullable().optional(),
    /** Delivery status; kept as text because the API enum is a superset of the shared one. */
    status: z.string(),
    readAt: isoDateTime.nullable().optional(),
    sentAt: isoDateTime.nullable().optional(),
    createdAt: isoDateTime,
  })
  .transform((row) => ({
    id: row.id,
    channel: row.channel,
    category: row.category ?? inferCategory(row.templateKey ?? null),
    templateKey: row.templateKey ?? null,
    subject: row.subject ?? row.payload?.subject ?? null,
    body: row.body ?? row.payload?.body ?? '',
    status: row.status,
    readAt: row.readAt ?? null,
    sentAt: row.sentAt ?? null,
    createdAt: row.createdAt,
  }));

export type CustomerNotification = z.output<typeof notificationWireSchema>;

/** Accepts the paginated envelope or a bare array, normalising both to `{ data, meta }`. */
export const notificationsPageSchema = z.union([
  z.object({ data: z.array(notificationWireSchema), meta: paginationMetaSchema }),
  z.array(notificationWireSchema).transform((data) => ({
    data,
    meta: buildPaginationMeta(1, Math.max(data.length, 1), data.length),
  })),
]);

export type NotificationsPage = z.output<typeof notificationsPageSchema>;

/** Template keys are dotted (`auth.password-reset`); the first segment names the domain. */
const CATEGORY_BY_TEMPLATE_DOMAIN: Readonly<Record<string, NotificationCategory>> = {
  auth: 'SECURITY',
  security: 'SECURITY',
  transfer: 'TRANSACTIONAL',
  transfers: 'TRANSACTIONAL',
  payment: 'TRANSACTIONAL',
  payments: 'TRANSACTIONAL',
  wallet: 'TRANSACTIONAL',
  marketing: 'MARKETING',
  system: 'SYSTEM',
  user: 'SYSTEM',
};

export function inferCategory(templateKey: string | null): NotificationCategory | null {
  if (!templateKey) return null;
  const domain = templateKey.split('.')[0]?.toLowerCase() ?? '';
  return CATEGORY_BY_TEMPLATE_DOMAIN[domain] ?? null;
}

export function isNotificationChannel(value: string): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}
