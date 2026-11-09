import { Injectable, Logger } from '@nestjs/common';
import type { Outbox } from '@bi-rem/db';

export const OUTBOX_TRANSPORT = Symbol('OUTBOX_TRANSPORT');

/** Delivery target for relayed outbox events (message broker, webhook fan-out…). */
export interface OutboxTransport {
  publish(event: Outbox): Promise<void>;
}

/** Phase 1 transport: events are written to the structured log. A broker arrives in Phase 2. */
@Injectable()
export class LogOutboxTransport implements OutboxTransport {
  private readonly logger = new Logger('Outbox');

  publish(event: Outbox): Promise<void> {
    this.logger.log(
      {
        outboxId: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
      },
      `Published ${event.eventType}`,
    );
    return Promise.resolve();
  }
}
