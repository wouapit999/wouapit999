import { Injectable } from '@nestjs/common';
import type { Outbox, Prisma } from '@bi-rem/db';

import { PrismaService } from '../../prisma/prisma.service.js';

export interface OutboxEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * Transactional outbox writer. Call `publish` with the same transaction client that performs
 * the business change so the event is committed atomically with it; the relay delivers it.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  publish(event: OutboxEvent, tx?: Prisma.TransactionClient): Promise<Outbox> {
    const client = tx ?? this.prisma.client;
    return client.outbox.create({
      data: {
        aggregateType: event.aggregateType.slice(0, 64),
        aggregateId: event.aggregateId.slice(0, 128),
        eventType: event.eventType.slice(0, 128),
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }

  countPending(): Promise<number> {
    return this.prisma.client.outbox.count({ where: { status: 'PENDING' } });
  }
}
