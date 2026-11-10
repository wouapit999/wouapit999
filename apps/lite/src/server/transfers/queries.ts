import type { Transfer } from '@/generated/prisma/client';
import type { TransferStatus, TransferType } from '@/generated/prisma/enums';

import { type Prisma, db } from '../db';
import { AppError } from '../errors';
import { type ActionContext, actorPartnerId, assertPermission, hasPermission } from '../rbac';

/**
 * Read side of transfers: history, detail with timeline, back-office search. Every function
 * scopes by the actor — a customer only ever sees transfers they sent or received.
 */

export type TransferPerspective = 'SENDER' | 'RECIPIENT' | 'STAFF';

export interface TransferTimelineEvent {
  readonly id: string;
  readonly type: string;
  readonly message: string;
  readonly createdAt: Date;
  /** Only populated for staff. */
  readonly data: Prisma.JsonValue | null;
}

export interface TransferDetail {
  readonly transfer: Transfer;
  readonly perspective: TransferPerspective;
  readonly events: readonly TransferTimelineEvent[];
  readonly provider: { id: string; name: string; code: string; simulated: boolean } | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function perspectiveFor(
  ctx: ActionContext,
  transfer: Transfer,
): Promise<TransferPerspective | null> {
  if (ctx.actor.type === 'SYSTEM' || hasPermission(ctx, 'transfers:read')) return 'STAFF';
  const partnerId = actorPartnerId(ctx);
  if (partnerId) {
    if (transfer.senderPartnerId === partnerId) return 'SENDER';
    if (transfer.recipientWalletId) {
      const wallet = await db.wallet.findUnique({
        where: { id: transfer.recipientWalletId },
        select: { partnerId: true },
      });
      if (wallet?.partnerId === partnerId) return 'RECIPIENT';
    }
    return null;
  }
  if (ctx.actor.type !== 'USER') return null;
  if (transfer.senderUserId === ctx.actor.id) return 'SENDER';
  // Recipients only learn about a transfer once the money has actually arrived.
  if (
    transfer.recipientUserId === ctx.actor.id &&
    (transfer.status === 'COMPLETED' || transfer.status === 'REVERSED')
  ) {
    return 'RECIPIENT';
  }
  return null;
}

/** Fields a recipient must not see about the sender's side of the transfer. */
function redactForRecipient(transfer: Transfer): Transfer {
  return {
    ...transfer,
    amlScore: 0,
    amlFlags: null,
    purpose: null,
    sourceOfFunds: null,
    idempotencyKey: '',
    commissionAmount: 0n,
    partnerId: null,
    sendAmountUsd: 0n,
    revenueUsd: 0n,
  };
}

const CUSTOMER_EVENT_TYPES = new Set([
  'CREATED',
  'HELD',
  'RELEASED',
  'FUNDS_RESERVED',
  'SENT_TO_PROVIDER',
  'PROVIDER_PENDING',
  'COMPLETED',
  'FAILED',
  'REJECTED',
  'REFUNDED',
  'REVERSED',
]);

/**
 * One transfer by id or reference with its timeline. Visible to the sender, the recipient
 * (once completed), the partners involved and staff with `transfers:read`; otherwise NOT_FOUND.
 * Non-staff never receive AML details or event payloads.
 */
export async function getTransferDetail(
  ctx: ActionContext,
  idOrReference: string,
): Promise<TransferDetail> {
  const key = idOrReference.trim();
  const transfer = await db.transfer.findUnique({
    where: UUID_PATTERN.test(key) ? { id: key } : { reference: key.toUpperCase() },
  });
  const perspective = transfer ? await perspectiveFor(ctx, transfer) : null;
  if (!transfer || !perspective) throw new AppError('NOT_FOUND', 'Transfer not found');

  const [events, provider] = await Promise.all([
    db.transferEvent.findMany({
      where: { transferId: transfer.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    transfer.providerId
      ? db.provider.findUnique({
          where: { id: transfer.providerId },
          select: { id: true, name: true, code: true, adapter: true },
        })
      : null,
  ]);
  const staff = perspective === 'STAFF';
  const visible =
    perspective === 'RECIPIENT'
      ? events.filter((event) => event.type === 'COMPLETED' || event.type === 'REVERSED')
      : staff
        ? events
        : events.filter((event) => CUSTOMER_EVENT_TYPES.has(event.type));
  return {
    transfer:
      perspective === 'RECIPIENT'
        ? redactForRecipient(transfer)
        : staff
          ? transfer
          : { ...transfer, amlScore: 0, amlFlags: null, commissionAmount: 0n, revenueUsd: 0n },
    perspective,
    events: visible.map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      createdAt: event.createdAt,
      data: staff ? event.data : null,
    })),
    provider: provider
      ? {
          id: provider.id,
          name: provider.name,
          code: provider.code,
          simulated: provider.adapter === 'simulator',
        }
      : null,
  };
}

export interface TransferListFilter {
  readonly status?: TransferStatus;
  readonly type?: TransferType;
  /** `sent`, `received` or both (default). */
  readonly direction?: 'sent' | 'received';
  readonly from?: Date;
  readonly to?: Date;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface TransferListItem {
  readonly id: string;
  readonly reference: string;
  readonly type: TransferType;
  /** WALLET (BI-Rem wallet) or MOBILE_MONEY (operator payout / cash-in). */
  readonly deliveryMethod: Transfer['deliveryMethod'];
  readonly status: TransferStatus;
  readonly direction: 'sent' | 'received';
  readonly counterpartyName: string;
  readonly counterpartyAccount: string;
  /** What moved on the actor's side: total debit when sent, amount received otherwise. */
  readonly amount: bigint;
  readonly currency: string;
  readonly sendAmount: bigint;
  readonly sourceCurrency: string;
  readonly receiveAmount: bigint;
  readonly targetCurrency: string;
  readonly feeAmount: bigint;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

const dateRange = (filter: { from?: Date; to?: Date }): Prisma.TransferWhereInput =>
  filter.from || filter.to
    ? {
        createdAt: {
          ...(filter.from ? { gte: filter.from } : {}),
          ...(filter.to ? { lte: filter.to } : {}),
        },
      }
    : {};

const paging = (filter: { page?: number; pageSize?: number }) => {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 20, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

/**
 * The actor's own history: transfers they sent (any status) or received (completed/reversed).
 * Works for customers and for partner users / API keys (scoped to the partner).
 */
export async function listMyTransfers(ctx: ActionContext, filter: TransferListFilter = {}) {
  if (ctx.actor.type === 'SYSTEM') throw new AppError('FORBIDDEN', 'No actor');
  const partnerId = actorPartnerId(ctx);
  const userId = ctx.actor.type === 'USER' ? ctx.actor.id : null;

  const sent: Prisma.TransferWhereInput = partnerId
    ? { senderPartnerId: partnerId }
    : { senderUserId: userId ?? undefined, senderPartnerId: null };
  const received: Prisma.TransferWhereInput = {
    status: { in: ['COMPLETED', 'REVERSED'] },
    // "Not sent by the actor" must keep rows whose sender column is NULL (a customer paying a
    // partner has no sender partner; an API payout has no sender user): in SQL `NOT (col = x)`
    // is not true for NULL, so the NULL case is spelled out.
    ...(partnerId
      ? {
          recipientWallet: { partnerId },
          OR: [{ senderPartnerId: null }, { senderPartnerId: { not: partnerId } }],
        }
      : {
          recipientUserId: userId ?? undefined,
          OR: [{ senderUserId: null }, { senderUserId: { not: userId ?? undefined } }],
        }),
  };
  const where: Prisma.TransferWhereInput = {
    AND: [
      filter.direction === 'sent'
        ? sent
        : filter.direction === 'received'
          ? received
          : { OR: [sent, received] },
      filter.status ? { status: filter.status } : {},
      filter.type ? { type: filter.type } : {},
      dateRange(filter),
    ],
  };
  const { page, pageSize, skip, take } = paging(filter);
  const [rows, total] = await Promise.all([
    db.transfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { recipientWallet: { select: { partnerId: true } } },
    }),
    db.transfer.count({ where }),
  ]);
  const items: TransferListItem[] = rows.map((row) => {
    const isSender = partnerId ? row.senderPartnerId === partnerId : row.senderUserId === userId;
    // A top-up is money arriving in the actor's own wallet.
    const direction = isSender && row.type !== 'TOPUP' ? 'sent' : 'received';
    return {
      id: row.id,
      reference: row.reference,
      type: row.type,
      deliveryMethod: row.deliveryMethod,
      status: row.status,
      direction,
      counterpartyName: direction === 'sent' ? row.recipientName : row.senderName,
      counterpartyAccount: direction === 'sent' ? row.recipientAccount : '',
      amount: direction === 'sent' ? row.totalDebit : row.receiveAmount,
      currency: direction === 'sent' ? row.sourceCurrency : row.targetCurrency,
      sendAmount: row.sendAmount,
      sourceCurrency: row.sourceCurrency,
      receiveAmount: row.receiveAmount,
      targetCurrency: row.targetCurrency,
      feeAmount: direction === 'sent' ? row.feeAmount : 0n,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    };
  });
  return { items, total, page, pageSize };
}

export interface AdminTransferFilter extends Omit<TransferListFilter, 'direction'> {
  /** Reference, sender/recipient name or recipient account. */
  readonly search?: string;
  readonly userId?: string;
  readonly partnerId?: string;
  readonly providerId?: string;
  readonly sourceCountry?: string;
  readonly targetCountry?: string;
}

/** Back-office transfer search. Requires `transfers:read`. */
export async function listTransfers(ctx: ActionContext, filter: AdminTransferFilter = {}) {
  assertPermission(ctx, 'transfers:read');
  const search = filter.search?.trim();
  const where: Prisma.TransferWhereInput = {
    AND: [
      filter.status ? { status: filter.status } : {},
      filter.type ? { type: filter.type } : {},
      filter.userId
        ? { OR: [{ senderUserId: filter.userId }, { recipientUserId: filter.userId }] }
        : {},
      filter.partnerId
        ? {
            OR: [
              { senderPartnerId: filter.partnerId },
              { partnerId: filter.partnerId },
              { recipientWallet: { partnerId: filter.partnerId } },
            ],
          }
        : {},
      filter.providerId ? { providerId: filter.providerId } : {},
      filter.sourceCountry ? { sourceCountry: filter.sourceCountry } : {},
      filter.targetCountry ? { targetCountry: filter.targetCountry } : {},
      dateRange(filter),
      search
        ? {
            OR: [
              { reference: { contains: search.toUpperCase() } },
              { senderName: { contains: search, mode: 'insensitive' } },
              { recipientName: { contains: search, mode: 'insensitive' } },
              { recipientAccount: { contains: search } },
              { providerRef: { contains: search } },
            ],
          }
        : {},
    ],
  };
  const { page, pageSize, skip, take } = paging(filter);
  const [items, total] = await Promise.all([
    db.transfer.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    db.transfer.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

/** Journals and entries of a transfer (audit trail of the money). Requires `transfers:read`. */
export async function getTransferJournals(ctx: ActionContext, transferId: string) {
  assertPermission(ctx, 'transfers:read');
  return db.journal.findMany({
    where: { transferId },
    orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
    include: {
      entries: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { account: { select: { code: true, name: true, type: true } } },
      },
    },
  });
}

/** AML alerts and case of a transfer. Requires `aml:read`. */
export async function getTransferCompliance(ctx: ActionContext, transferId: string) {
  assertPermission(ctx, 'aml:read');
  const [alerts, cases] = await Promise.all([
    db.amlAlert.findMany({ where: { transferId }, orderBy: { createdAt: 'asc' } }),
    db.amlCase.findMany({ where: { transferId }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { alerts, cases };
}
