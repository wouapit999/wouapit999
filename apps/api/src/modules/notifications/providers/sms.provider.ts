import { Injectable, Logger } from '@nestjs/common';

import type {
  NotificationProvider,
  OutboundMessage,
  ProviderResult,
} from './notification-provider.js';

/**
 * PHASE 1 STUB — logs SMS messages instead of sending them.
 *
 * Real gateways (Africa's Talking, Twilio, operator direct connections) are integrated in
 * Phase 2 behind this same interface; nothing else in the pipeline needs to change. Message
 * bodies are intentionally NOT logged (they may contain one-time codes), only metadata.
 */
@Injectable()
export class LoggingSmsProvider implements NotificationProvider {
  readonly channel = 'SMS' as const;
  private readonly logger = new Logger(LoggingSmsProvider.name);

  send(message: OutboundMessage): Promise<ProviderResult> {
    this.logger.warn(
      {
        notificationId: message.notificationId,
        recipient: maskPhone(message.recipient),
        templateKey: message.templateKey,
        length: message.body.length,
      },
      'SMS gateway not configured (Phase 1 stub): message logged, not sent',
    );
    return Promise.resolve({ providerMessageId: `stub-${message.notificationId}` });
  }
}

export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}
