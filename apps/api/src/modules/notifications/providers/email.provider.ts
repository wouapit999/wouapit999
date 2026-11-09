import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

import type { AppConfig } from '../../../config/env.js';
import type {
  NotificationProvider,
  OutboundMessage,
  ProviderResult,
} from './notification-provider.js';

/** SMTP e-mail delivery through Nodemailer (Mailpit locally, any SMTP relay in staging/prod). */
@Injectable()
export class EmailProvider implements NotificationProvider {
  readonly channel = 'EMAIL' as const;
  private readonly logger = new Logger(EmailProvider.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASS', { infer: true });
    const port = config.get('SMTP_PORT', { infer: true });
    this.from = config.get('SMTP_FROM', { infer: true });
    this.transporter = nodemailer.createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port,
      secure: port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
      connectionTimeout: 10_000,
    });
  }

  async send(message: OutboundMessage): Promise<ProviderResult> {
    const info = (await this.transporter.sendMail({
      from: this.from,
      to: message.recipient,
      subject: message.subject ?? '',
      text: message.body,
      headers: { 'X-BI-Rem-Notification': message.notificationId },
    })) as { messageId?: string };
    this.logger.debug(
      { notificationId: message.notificationId, messageId: info.messageId },
      'E-mail sent',
    );
    return { providerMessageId: info.messageId };
  }

  /** Used by the readiness check in environments where SMTP is mandatory. */
  verify(): Promise<boolean> {
    return this.transporter.verify().then(
      () => true,
      () => false,
    );
  }
}
