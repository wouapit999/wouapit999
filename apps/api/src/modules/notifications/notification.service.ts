import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Notification, NotificationChannel, NotificationTemplate, Prisma } from '@bi-rem/db';
import type { Paginated } from '@bi-rem/shared';

import { RequestContext } from '../../common/context/request-context.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { paginate, toPageArgs } from '../../common/pagination/pagination.js';
import type { AppConfig } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ListNotificationsQueryDto, UpsertTemplateDto } from './dto/notification.dto.js';
import { NOTIFICATION_QUEUE, type NotificationQueue } from './queue/notification-queue.js';
import {
  extractPlaceholders,
  renderTemplate,
  type TemplateVariables,
} from './template-renderer.js';

export interface SendNotificationInput {
  userId: string;
  channel: NotificationChannel;
  templateKey: string;
  variables?: TemplateVariables;
  /** Overrides the user's locale. */
  locale?: string;
  /** Bypasses channel preferences (security-critical messages such as password resets). */
  force?: boolean;
  /**
   * Marks messages that carry credentials (reset / invitation links, one-time codes). Their
   * rendered body and variables are scrubbed from the stored payload once delivery was
   * attempted, and hidden from administrators in the meantime.
   */
  sensitive?: boolean;
}

/** Marker kept in `notifications.payload` for sensitive messages. */
export const SENSITIVE_PAYLOAD_FLAG = 'sensitive';

export type SendNotificationResult =
  | { status: 'QUEUED'; notification: Notification }
  | { status: 'SKIPPED'; reason: 'PREFERENCE_DISABLED' | 'NO_RECIPIENT' | 'USER_NOT_FOUND' };

export interface ChannelPreference {
  channel: NotificationChannel;
  enabled: boolean;
}

export interface RenderedTemplate {
  subject: string | null;
  body: string;
  locale: string;
  templateId: string;
}

const DEFAULT_LOCALE = 'en';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly appName: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_QUEUE) private readonly queue: NotificationQueue,
    config: ConfigService<AppConfig, true>,
  ) {
    this.appName = config.get('APP_NAME', { infer: true });
  }

  /**
   * Renders the template for the user's locale, persists the notification and enqueues it.
   * Respects channel preferences unless `force` is set. Never throws for "soft" outcomes
   * (unknown user, disabled channel, missing recipient): callers get a SKIPPED result.
   */
  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { id: true, email: true, phone: true, locale: true, firstName: true },
    });
    if (!user) return { status: 'SKIPPED', reason: 'USER_NOT_FOUND' };

    if (!input.force && !(await this.isChannelEnabled(user.id, input.channel))) {
      return { status: 'SKIPPED', reason: 'PREFERENCE_DISABLED' };
    }

    const recipient = recipientFor(input.channel, user);
    if (!recipient) return { status: 'SKIPPED', reason: 'NO_RECIPIENT' };

    const locale = input.locale ?? user.locale;
    const variables: TemplateVariables = {
      appName: this.appName,
      firstName: user.firstName,
      ...input.variables,
    };
    const rendered = await this.render(input.templateKey, input.channel, locale, variables);

    const notification = await this.prisma.client.notification.create({
      data: {
        userId: user.id,
        channel: input.channel,
        templateKey: input.templateKey,
        recipient,
        payload: {
          subject: rendered.subject,
          body: rendered.body,
          locale: rendered.locale,
          templateId: rendered.templateId,
          variables,
          ...(input.sensitive ? { [SENSITIVE_PAYLOAD_FLAG]: true } : {}),
        },
        status: 'PENDING',
      },
    });

    try {
      await this.queue.enqueue(notification.id);
    } catch (error) {
      this.logger.error(
        { err: error, notificationId: notification.id },
        'Failed to enqueue notification',
      );
      const failed = await this.prisma.client.notification.update({
        where: { id: notification.id },
        data: { status: 'FAILED', lastError: 'Enqueue failed' },
      });
      return { status: 'QUEUED', notification: failed };
    }
    const queued = await this.prisma.client.notification.update({
      where: { id: notification.id },
      data: { status: 'QUEUED' },
    });
    return { status: 'QUEUED', notification: queued };
  }

  /** Resolves the active template (exact locale, then `en`) and interpolates variables. */
  async render(
    templateKey: string,
    channel: NotificationChannel,
    locale: string,
    variables: TemplateVariables,
  ): Promise<RenderedTemplate> {
    const template = await this.findTemplate(templateKey, channel, locale);
    if (!template) {
      throw ApiException.notFound(
        `No active ${channel} template "${templateKey}" for locale ${locale}`,
      );
    }
    return NotificationService.renderWith(template, variables);
  }

  static renderWith(
    template: NotificationTemplate,
    variables: TemplateVariables,
  ): RenderedTemplate {
    return {
      subject: template.subject ? renderTemplate(template.subject, variables) : null,
      body: renderTemplate(template.body, variables),
      locale: template.locale,
      templateId: template.id,
    };
  }

  private async findTemplate(
    key: string,
    channel: NotificationChannel,
    locale: string,
  ): Promise<NotificationTemplate | null> {
    const normalised = locale.toLowerCase().split('-')[0] ?? DEFAULT_LOCALE;
    const candidates =
      normalised === DEFAULT_LOCALE ? [DEFAULT_LOCALE] : [normalised, DEFAULT_LOCALE];
    const rows = await this.prisma.client.notificationTemplate.findMany({
      where: { key, channel, isActive: true, locale: { in: candidates } },
    });
    for (const candidate of candidates) {
      const match = rows.find((row) => row.locale === candidate);
      if (match) return match;
    }
    return null;
  }

  // --- Preferences ----------------------------------------------------------------------

  async isChannelEnabled(userId: string, channel: NotificationChannel): Promise<boolean> {
    const preference = await this.prisma.client.notificationPreference.findUnique({
      where: { userId_channel: { userId, channel } },
    });
    return preference?.enabled ?? true;
  }

  async getPreferences(userId: string): Promise<ChannelPreference[]> {
    const rows = await this.prisma.client.notificationPreference.findMany({ where: { userId } });
    const byChannel = new Map(rows.map((row) => [row.channel, row.enabled]));
    return (['EMAIL', 'SMS', 'PUSH', 'IN_APP'] as const).map((channel) => ({
      channel,
      enabled: byChannel.get(channel) ?? true,
    }));
  }

  async updatePreferences(
    userId: string,
    preferences: ChannelPreference[],
  ): Promise<ChannelPreference[]> {
    RequestContext.recordBefore(await this.getPreferences(userId));
    await this.prisma.client.$transaction(
      preferences.map((preference) =>
        this.prisma.client.notificationPreference.upsert({
          where: { userId_channel: { userId, channel: preference.channel } },
          update: { enabled: preference.enabled },
          create: { userId, channel: preference.channel, enabled: preference.enabled },
        }),
      ),
    );
    const after = await this.getPreferences(userId);
    RequestContext.recordAfter(after);
    return after;
  }

  // --- Notification history -------------------------------------------------------------

  /**
   * Notification history. With `restrictToUserId` (self-service) rows are returned verbatim;
   * without it (administration) the body of sensitive messages that have not been scrubbed yet
   * is hidden, so staff can never read another person's reset link or one-time code.
   */
  async list(
    query: ListNotificationsQueryDto,
    restrictToUserId?: string,
  ): Promise<Paginated<Notification>> {
    const where: Prisma.NotificationWhereInput = {
      ...(restrictToUserId
        ? { userId: restrictToUserId }
        : query.userId
          ? { userId: query.userId }
          : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.unreadOnly === 'true' ? { readAt: null } : {}),
    };
    const [items, total] = await this.prisma.client.$transaction([
      this.prisma.client.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toPageArgs(query),
      }),
      this.prisma.client.notification.count({ where }),
    ]);
    const visible = restrictToUserId ? items : items.map(hideSensitivePayload);
    return paginate(visible, total, query);
  }

  async markRead(notificationId: string, userId: string): Promise<Notification> {
    const notification = await this.prisma.client.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) throw ApiException.notFound('Notification not found');
    if (notification.readAt) return notification;
    return this.prisma.client.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  // --- Templates ------------------------------------------------------------------------

  listTemplates(): Promise<NotificationTemplate[]> {
    return this.prisma.client.notificationTemplate.findMany({
      orderBy: [{ key: 'asc' }, { channel: 'asc' }, { locale: 'asc' }],
    });
  }

  async upsertTemplate(dto: UpsertTemplateDto): Promise<NotificationTemplate> {
    if (dto.channel === 'EMAIL' && !dto.subject) {
      throw ApiException.badRequest('Email templates require a subject', [
        { path: 'subject', message: 'Required for EMAIL templates' },
      ]);
    }
    const used = extractPlaceholders(`${dto.subject ?? ''} ${dto.body}`);
    const declared = new Set(dto.variables);
    const undeclared = used.filter((name) => !declared.has(name));
    if (undeclared.length) {
      throw ApiException.badRequest(
        'Template uses undeclared variables',
        undeclared.map((name) => ({
          path: 'variables',
          message: `Placeholder "${name}" is not declared`,
        })),
      );
    }
    const where = {
      key_channel_locale: { key: dto.key, channel: dto.channel, locale: dto.locale },
    };
    const existing = await this.prisma.client.notificationTemplate.findUnique({ where });
    if (existing) RequestContext.recordBefore(existing);
    const data = {
      subject: dto.subject ?? null,
      body: dto.body,
      variables: dto.variables,
      isActive: dto.isActive,
    };
    const saved = await this.prisma.client.notificationTemplate.upsert({
      where,
      update: data,
      create: { key: dto.key, channel: dto.channel, locale: dto.locale, ...data },
    });
    RequestContext.setResourceId(saved.id);
    RequestContext.recordAfter(saved);
    return saved;
  }

  queueStats(): Promise<{ kind: string; waiting: number; active: number; failed: number }> {
    return this.queue.stats().then((stats) => ({ kind: this.queue.kind, ...stats }));
  }
}

export function isSensitivePayload(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as Record<string, unknown>)[SENSITIVE_PAYLOAD_FLAG] === true
  );
}

/** Replaces the credential-bearing parts of a sensitive payload with markers. */
export function scrubSensitivePayload(payload: Prisma.JsonValue): Prisma.InputJsonObject {
  const source =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload : {};
  return {
    ...source,
    body: '[REDACTED]',
    variables: {},
    [SENSITIVE_PAYLOAD_FLAG]: true,
    scrubbedAt: new Date().toISOString(),
  };
}

function hideSensitivePayload(notification: Notification): Notification {
  if (!isSensitivePayload(notification.payload)) return notification;
  return {
    ...notification,
    payload: scrubSensitivePayload(notification.payload) as Prisma.JsonValue,
  };
}

function recipientFor(
  channel: NotificationChannel,
  user: { id: string; email: string; phone: string | null },
): string | null {
  switch (channel) {
    case 'EMAIL':
      return user.email;
    case 'SMS':
      return user.phone;
    case 'IN_APP':
      return user.id;
    case 'PUSH':
      // Push tokens arrive with the mobile apps (Phase 11).
      return null;
  }
}
