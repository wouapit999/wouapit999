// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  inferCategory,
  notificationWireSchema,
  notificationsPageSchema,
} from '@/lib/notifications';

const id = '8a1f2c3d-0000-4000-8000-000000000000';
const userId = '9b2e3d4f-0000-4000-8000-000000000000';

/** Exactly what `GET /v1/notifications/me` returns today: the Prisma `Notification` row. */
const prismaRow = {
  id,
  userId,
  channel: 'EMAIL',
  templateKey: 'auth.password-reset',
  recipient: 'ada@example.com',
  payload: {
    subject: 'Reset your password',
    body: 'Click the link…',
    locale: 'en',
    templateId: id,
  },
  status: 'CANCELLED',
  attempts: 1,
  lastError: null,
  sentAt: '2026-11-09T10:00:00.000Z',
  deliveredAt: null,
  readAt: null,
  createdAt: '2026-11-09T09:59:00.000Z',
  updatedAt: '2026-11-09T10:00:00.000Z',
};

/** The flattened read model described by `@bi-rem/shared` `notificationSchema`. */
const sharedRow = {
  id,
  userId,
  channel: 'IN_APP',
  category: 'TRANSACTIONAL',
  templateKey: null,
  subject: null,
  body: 'Your transfer was delivered.',
  status: 'DELIVERED',
  readAt: '2026-11-09T11:00:00.000Z',
  sentAt: null,
  createdAt: '2026-11-09T10:30:00.000Z',
};

describe('notificationWireSchema', () => {
  it('normalises the stored row, lifting subject/body out of payload and inferring the category', () => {
    const parsed = notificationWireSchema.parse(prismaRow);
    expect(parsed).toEqual({
      id,
      channel: 'EMAIL',
      category: 'SECURITY',
      templateKey: 'auth.password-reset',
      subject: 'Reset your password',
      body: 'Click the link…',
      status: 'CANCELLED',
      readAt: null,
      sentAt: '2026-11-09T10:00:00.000Z',
      createdAt: '2026-11-09T09:59:00.000Z',
    });
    expect(parsed).not.toHaveProperty('recipient');
  });

  it('accepts the shared flattened shape unchanged', () => {
    const parsed = notificationWireSchema.parse(sharedRow);
    expect(parsed.category).toBe('TRANSACTIONAL');
    expect(parsed.body).toBe('Your transfer was delivered.');
    expect(parsed.readAt).toBe('2026-11-09T11:00:00.000Z');
  });

  it('rejects rows without an id, channel or creation date', () => {
    expect(notificationWireSchema.safeParse({ ...prismaRow, id: 'nope' }).success).toBe(false);
    expect(notificationWireSchema.safeParse({ ...prismaRow, channel: 'FAX' }).success).toBe(false);
    expect(notificationWireSchema.safeParse({ ...prismaRow, createdAt: 'yesterday' }).success).toBe(
      false,
    );
  });
});

describe('notificationsPageSchema', () => {
  it('accepts the paginated envelope', () => {
    const page = notificationsPageSchema.parse({
      data: [prismaRow],
      meta: {
        page: 2,
        pageSize: 20,
        totalItems: 21,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    });
    expect(page.data).toHaveLength(1);
    expect(page.meta.page).toBe(2);
  });

  it('wraps a bare array in single-page meta', () => {
    const page = notificationsPageSchema.parse([sharedRow, prismaRow]);
    expect(page.meta).toMatchObject({ page: 1, totalItems: 2, totalPages: 1, hasNextPage: false });
    const empty = notificationsPageSchema.parse([]);
    expect(empty.meta.totalPages).toBe(0);
  });
});

describe('inferCategory', () => {
  it('maps the template domain to a category and gives up on unknown keys', () => {
    expect(inferCategory('auth.login-alert')).toBe('SECURITY');
    expect(inferCategory('transfer.delivered')).toBe('TRANSACTIONAL');
    expect(inferCategory('user.welcome')).toBe('SYSTEM');
    expect(inferCategory('kyc.approved')).toBeNull();
    expect(inferCategory(null)).toBeNull();
  });
});
