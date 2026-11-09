import type { NotificationChannel } from '@bi-rem/db';

export interface OutboundMessage {
  notificationId: string;
  userId: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string | null;
  body: string;
  locale: string;
  templateKey: string;
}

export interface ProviderResult {
  /** Provider-side message id, when the gateway returns one. */
  providerMessageId?: string;
  /** `true` when the provider confirms final delivery synchronously (e.g. in-app rows). */
  delivered?: boolean;
}

/** One delivery channel implementation. Registered by channel in the processor. */
export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(message: OutboundMessage): Promise<ProviderResult>;
}

export const NOTIFICATION_PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');
