import 'server-only';

import type { Transfer } from '@/generated/prisma/client';
import { listAvailableProviders } from '@/server/connectors/providers';
import { AppError } from '@/server/errors';
import { formatRate } from '@/server/money';
import type { ApiKeyAuthentication } from '@/server/partners';
import type {
  RecipientInput,
  TransferDetail,
  TransferListItem,
  TransferPreview,
} from '@/server/transfers';
import { listMyWallets } from '@/server/wallets';

import type { ApiRecipient } from './schemas';

/**
 * Translation between the public API vocabulary and the transfer engine: sender wallet
 * selection, recipient resolution (provider code → provider) and the JSON shapes returned to
 * partners. Money is always a string of minor units.
 */

/** The partner's own wallet in `currency` (default: the partner's home currency). */
export async function resolveSenderWallet(auth: ApiKeyAuthentication, currency?: string) {
  const wanted = currency ?? auth.partner.currency;
  const wallets = await listMyWallets(auth.ctx);
  const wallet = wallets.find((candidate) => candidate.currency === wanted);
  if (!wallet) {
    throw new AppError('VALIDATION', `This partner has no ${wanted} wallet`, {
      fieldErrors: { sourceCurrency: [`No ${wanted} wallet`] },
    });
  }
  return wallet;
}

const normaliseAccount = (value: string): string => value.replace(/[\s().-]/g, '');

/** API recipient → engine recipient. Mobile-money providers are addressed by their code. */
export async function resolveRecipient(recipient: ApiRecipient): Promise<RecipientInput> {
  if (recipient.type === 'wallet') {
    return { kind: 'WALLET', identifier: recipient.identifier };
  }
  const providers = await listAvailableProviders();
  const provider = providers.find((candidate) => candidate.code === recipient.provider);
  if (!provider?.supportsPayout) {
    throw new AppError('VALIDATION', 'This provider is not available for payouts', {
      fieldErrors: { 'recipient.provider': ['Unknown or unavailable provider'] },
    });
  }
  return {
    kind: 'MOBILE_MONEY',
    providerId: provider.id,
    accountNumber: recipient.accountNumber,
    name: recipient.name,
  };
}

/**
 * True when a replayed transfer (same Idempotency-Key) matches the request that is being
 * repeated. A key reused for a different amount or recipient is a client bug and must not be
 * answered with somebody else's transfer as if it had succeeded.
 */
export function matchesOriginalRequest(
  transfer: Pick<Transfer, 'sendAmount' | 'recipientAccount' | 'providerId' | 'deliveryMethod'>,
  request: { amount?: bigint; recipient: RecipientInput },
): boolean {
  if (request.amount !== undefined && request.amount !== transfer.sendAmount) return false;
  const { recipient } = request;
  if (recipient.kind === 'MOBILE_MONEY') {
    return (
      transfer.deliveryMethod === 'MOBILE_MONEY' &&
      transfer.providerId === recipient.providerId &&
      transfer.recipientAccount === normaliseAccount(recipient.accountNumber)
    );
  }
  if (recipient.kind === 'WALLET') {
    return (
      transfer.deliveryMethod === 'WALLET' &&
      normaliseAccount(transfer.recipientAccount).toLowerCase() ===
        normaliseAccount(recipient.identifier).toLowerCase()
    );
  }
  return false;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** A transfer as seen by the partner that sent it. */
export function serializeSentTransfer(transfer: Transfer) {
  return {
    id: transfer.id,
    reference: transfer.reference,
    type: transfer.type,
    status: transfer.status,
    direction: 'sent' as const,
    deliveryMethod: transfer.deliveryMethod,
    sourceCountry: transfer.sourceCountry,
    targetCountry: transfer.targetCountry,
    sourceCurrency: transfer.sourceCurrency,
    targetCurrency: transfer.targetCurrency,
    sendAmount: transfer.sendAmount.toString(),
    feeAmount: transfer.feeAmount.toString(),
    totalDebit: transfer.totalDebit.toString(),
    receiveAmount: transfer.receiveAmount.toString(),
    /** Major units of target currency per major unit of source currency, after the margin. */
    rate: transfer.customerRate.toString(),
    recipientName: transfer.recipientName,
    recipientAccount: transfer.recipientAccount,
    purpose: transfer.purpose,
    sourceOfFunds: transfer.sourceOfFunds,
    note: transfer.note,
    failureCode: transfer.failureCode,
    failureReason: transfer.failureReason,
    createdAt: transfer.createdAt.toISOString(),
    completedAt: iso(transfer.completedAt),
    reversedAt: iso(transfer.reversedAt),
  };
}

/** A payment received by the partner: nothing about the sender's fees or declarations. */
function serializeReceivedTransfer(transfer: Transfer) {
  return {
    id: transfer.id,
    reference: transfer.reference,
    type: transfer.type,
    status: transfer.status,
    direction: 'received' as const,
    deliveryMethod: transfer.deliveryMethod,
    sourceCountry: transfer.sourceCountry,
    targetCountry: transfer.targetCountry,
    targetCurrency: transfer.targetCurrency,
    receiveAmount: transfer.receiveAmount.toString(),
    senderName: transfer.senderName,
    note: transfer.note,
    createdAt: transfer.createdAt.toISOString(),
    completedAt: iso(transfer.completedAt),
    reversedAt: iso(transfer.reversedAt),
  };
}

export function serializeTransferDetail(detail: TransferDetail) {
  const base =
    detail.perspective === 'RECIPIENT'
      ? serializeReceivedTransfer(detail.transfer)
      : serializeSentTransfer(detail.transfer);
  return {
    ...base,
    provider: detail.provider
      ? {
          code: detail.provider.code,
          name: detail.provider.name,
          simulated: detail.provider.simulated,
        }
      : null,
    timeline: detail.events.map((event) => ({
      type: event.type,
      message: event.message,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export function serializeTransferListItem(item: TransferListItem) {
  return {
    id: item.id,
    reference: item.reference,
    type: item.type,
    status: item.status,
    direction: item.direction,
    deliveryMethod: item.deliveryMethod,
    counterpartyName: item.counterpartyName,
    counterpartyAccount: item.counterpartyAccount || null,
    /** What moved on your side: total debit when sent, amount received otherwise. */
    amount: item.amount.toString(),
    currency: item.currency,
    sendAmount: item.direction === 'sent' ? item.sendAmount.toString() : null,
    sourceCurrency: item.sourceCurrency,
    receiveAmount: item.receiveAmount.toString(),
    targetCurrency: item.targetCurrency,
    feeAmount: item.direction === 'sent' ? item.feeAmount.toString() : null,
    createdAt: item.createdAt.toISOString(),
    completedAt: iso(item.completedAt),
  };
}

export function serializeQuote(preview: TransferPreview) {
  const { plan, pricing } = preview;
  return {
    quoteId: preview.quoteId,
    expiresAt: iso(preview.expiresAt),
    type: plan.type,
    international: plan.international,
    deliveryMethod: plan.recipient.deliveryMethod,
    sourceCountry: plan.sender.countryCode,
    targetCountry: plan.recipient.countryCode,
    sourceCurrency: pricing.sourceCurrency,
    targetCurrency: pricing.targetCurrency,
    sendAmount: pricing.sendAmount.toString(),
    feeAmount: pricing.feeAmount.toString(),
    totalDebit: pricing.totalDebit.toString(),
    receiveAmount: pricing.receiveAmount.toString(),
    /** Major units of target currency per major unit of source currency, after the margin. */
    rate: formatRate(pricing.customerRate),
    recipientName: plan.recipient.name,
    recipientAccount: plan.recipient.account,
  };
}
