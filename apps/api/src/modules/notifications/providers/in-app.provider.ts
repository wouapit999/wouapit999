import { Injectable } from '@nestjs/common';

import type {
  NotificationProvider,
  OutboundMessage,
  ProviderResult,
} from './notification-provider.js';

/**
 * In-app notifications live entirely in the `notifications` table and are read by the portals
 * through the API, so "delivery" is complete as soon as the row exists.
 */
@Injectable()
export class InAppProvider implements NotificationProvider {
  readonly channel = 'IN_APP' as const;

  send(_message: OutboundMessage): Promise<ProviderResult> {
    return Promise.resolve({ delivered: true });
  }
}
