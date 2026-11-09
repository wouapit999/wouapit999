import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { NotificationTemplate } from '@bi-rem/db';

import type { AppConfig } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  isSensitivePayload,
  NotificationService,
  scrubSensitivePayload,
} from './notification.service.js';
import { InProcessNotificationQueue } from './queue/in-process.queue.js';

const USER = {
  id: '6c1f2d9e-2f3a-4b5c-8d6e-7f8091a2b3c4',
  email: 'awa@example.com',
  phone: '+221771234567',
  locale: 'fr',
  firstName: 'Awa',
};

function template(partial: Partial<NotificationTemplate>): NotificationTemplate {
  return {
    id: 'tpl-' + (partial.locale ?? 'en'),
    key: 'welcome',
    channel: 'EMAIL',
    locale: 'en',
    subject: 'Welcome to {{appName}}',
    body: 'Hello {{firstName}}, sign in at {{portalUrl}}.',
    variables: ['firstName', 'appName', 'portalUrl'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

interface Harness {
  service: NotificationService;
  queue: InProcessNotificationQueue;
  handler: { process: jest.Mock<(id: string) => Promise<void>> };
  notifications: Map<string, Record<string, unknown>>;
  templates: NotificationTemplate[];
  preferences: Array<{ channel: string; enabled: boolean }>;
  userFound: boolean;
}

function harness(): Harness {
  const state: Harness = {
    service: undefined as unknown as NotificationService,
    queue: undefined as unknown as InProcessNotificationQueue,
    handler: { process: jest.fn<(id: string) => Promise<void>>(async () => undefined) },
    notifications: new Map(),
    templates: [
      template({ locale: 'en' }),
      template({
        locale: 'fr',
        subject: 'Bienvenue sur {{appName}}',
        body: 'Bonjour {{firstName}}',
      }),
    ],
    preferences: [],
    userFound: true,
  };
  let seq = 0;
  const prisma = {
    client: {
      user: { findFirst: jest.fn(async () => (state.userFound ? USER : null)) },
      notificationPreference: {
        findUnique: jest.fn(
          async (args: { where: { userId_channel: { channel: string } } }) =>
            state.preferences.find((p) => p.channel === args.where.userId_channel.channel) ?? null,
        ),
      },
      notificationTemplate: {
        findMany: jest.fn(
          async (args: { where: { locale: { in: string[] }; channel: string; key: string } }) =>
            state.templates.filter(
              (t) =>
                args.where.locale.in.includes(t.locale) &&
                t.channel === args.where.channel &&
                t.key === args.where.key,
            ),
        ),
      },
      notification: {
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          const row = { id: `n-${++seq}`, ...args.data };
          state.notifications.set(row.id, row);
          return row;
        }),
        update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = { ...state.notifications.get(args.where.id), ...args.data };
          state.notifications.set(args.where.id, row);
          return row;
        }),
      },
    },
  } as unknown as PrismaService;
  const config = {
    get: (key: string) => (key === 'APP_NAME' ? 'BI-Rem' : undefined),
  } as unknown as ConfigService<AppConfig, true>;
  state.queue = new InProcessNotificationQueue(state.handler, 1, 0);
  state.service = new NotificationService(prisma, state.queue, config);
  return state;
}

describe('NotificationService', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('renders the template in the user locale, persists and enqueues the notification', async () => {
    const result = await h.service.send({
      userId: USER.id,
      channel: 'EMAIL',
      templateKey: 'welcome',
      variables: { portalUrl: 'https://app.bi-rem.local' },
    });
    expect(result.status).toBe('QUEUED');
    if (result.status !== 'QUEUED') return;
    expect(result.notification.status).toBe('QUEUED');
    const payload = result.notification.payload as {
      subject: string;
      body: string;
      locale: string;
    };
    expect(payload.locale).toBe('fr');
    expect(payload.subject).toBe('Bienvenue sur BI-Rem');
    expect(payload.body).toBe('Bonjour Awa');
    expect(result.notification.recipient).toBe(USER.email);
    await h.queue.close();
    expect(h.handler.process).toHaveBeenCalledWith(result.notification.id);
  });

  it('falls back to the English template when the locale is missing', async () => {
    h.templates = h.templates.filter((t) => t.locale === 'en');
    const result = await h.service.send({
      userId: USER.id,
      channel: 'EMAIL',
      templateKey: 'welcome',
      variables: { portalUrl: 'u' },
    });
    expect(result.status).toBe('QUEUED');
    if (result.status !== 'QUEUED') return;
    const payload = result.notification.payload as {
      subject: string;
      body: string;
      locale: string;
    };
    expect(payload.locale).toBe('en');
    expect(payload.body).toBe('Hello Awa, sign in at u.');
  });

  it('respects a disabled channel preference unless forced', async () => {
    h.preferences = [{ channel: 'EMAIL', enabled: false }];
    const skipped = await h.service.send({
      userId: USER.id,
      channel: 'EMAIL',
      templateKey: 'welcome',
    });
    expect(skipped).toEqual({ status: 'SKIPPED', reason: 'PREFERENCE_DISABLED' });
    const forced = await h.service.send({
      userId: USER.id,
      channel: 'EMAIL',
      templateKey: 'welcome',
      force: true,
    });
    expect(forced.status).toBe('QUEUED');
  });

  it('skips unknown users and channels without a recipient', async () => {
    h.userFound = false;
    expect(
      await h.service.send({ userId: 'nope', channel: 'EMAIL', templateKey: 'welcome' }),
    ).toEqual({
      status: 'SKIPPED',
      reason: 'USER_NOT_FOUND',
    });
    h.userFound = true;
    expect(
      await h.service.send({ userId: USER.id, channel: 'PUSH', templateKey: 'welcome' }),
    ).toEqual({
      status: 'SKIPPED',
      reason: 'NO_RECIPIENT',
    });
  });

  it('flags sensitive messages and hides their body from administrators until scrubbed', async () => {
    const result = await h.service.send({
      userId: USER.id,
      channel: 'EMAIL',
      templateKey: 'welcome',
      sensitive: true,
      variables: { portalUrl: 'https://app/reset?token=SECRET' },
    });
    expect(result.status).toBe('QUEUED');
    if (result.status !== 'QUEUED') return;
    expect(result.notification.payload).toMatchObject({ sensitive: true });
    expect(isSensitivePayload(result.notification.payload)).toBe(true);
    expect(isSensitivePayload({ body: 'x' })).toBe(false);

    const scrubbed = scrubSensitivePayload(result.notification.payload);
    expect(scrubbed.body).toBe('[REDACTED]');
    expect(scrubbed.variables).toEqual({});
    expect(scrubbed.subject).toBe('Bienvenue sur BI-Rem');
    expect(JSON.stringify(scrubbed)).not.toContain('SECRET');
  });

  it('rejects when no active template exists', async () => {
    await expect(
      h.service.send({ userId: USER.id, channel: 'SMS', templateKey: 'welcome' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('validates templates on upsert: subject for e-mail and declared placeholders', async () => {
    await expect(
      h.service.upsertTemplate({
        key: 'x.y',
        channel: 'EMAIL',
        locale: 'en',
        body: 'b',
        variables: [],
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      h.service.upsertTemplate({
        key: 'x.y',
        channel: 'SMS',
        locale: 'en',
        body: 'Hi {{name}}',
        variables: [],
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
