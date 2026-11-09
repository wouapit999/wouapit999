import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, type Outbox } from '@bi-rem/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import { OUTBOX_TRANSPORT, type OutboxTransport } from './outbox.transport.js';

export const OUTBOX_RELAY_INTERVAL_MS = 10_000;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 10;

/**
 * Polls pending outbox rows (locking them with `FOR UPDATE SKIP LOCKED` so several API
 * instances can relay concurrently), hands them to the transport and marks them published.
 * Rows that keep failing are parked as FAILED after `MAX_ATTEMPTS` for manual inspection.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OUTBOX_TRANSPORT) private readonly transport: OutboxTransport,
  ) {}

  @Interval('outbox-relay', OUTBOX_RELAY_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let processed: number;
      do {
        processed = await this.relayBatch();
      } while (processed === BATCH_SIZE);
    } catch (error) {
      this.logger.error({ err: error }, 'Outbox relay tick failed');
    } finally {
      this.running = false;
    }
  }

  /** Relays one batch and returns the number of rows handled. */
  async relayBatch(): Promise<number> {
    return this.prisma.client.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Outbox[]>(Prisma.sql`
          SELECT id, aggregate_type AS "aggregateType", aggregate_id AS "aggregateId",
                 event_type AS "eventType", payload, status, attempts,
                 last_error AS "lastError", published_at AS "publishedAt", created_at AS "createdAt"
          FROM outbox
          WHERE status = 'PENDING'::outbox_status
          ORDER BY created_at ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `);
        for (const row of rows) {
          try {
            await this.transport.publish(row);
            await tx.outbox.update({
              where: { id: row.id },
              data: { status: 'PUBLISHED', publishedAt: new Date(), attempts: { increment: 1 } },
            });
          } catch (error) {
            const attempts = row.attempts + 1;
            await tx.outbox.update({
              where: { id: row.id },
              data: {
                attempts,
                lastError: error instanceof Error ? error.message.slice(0, 1_000) : String(error),
                status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
              },
            });
          }
        }
        return rows.length;
      },
      { timeout: 30_000 },
    );
  }
}
