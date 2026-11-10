import { AppError } from '@/server/errors';
import { parseMoney } from '@/server/money';
import { getPartner } from '@/server/partners';
import type { ActionContext } from '@/server/rbac';
import { createTransfer, previewTransfer } from '@/server/transfers';
import { listMyWallets } from '@/server/wallets';

/**
 * Agent cash-in: a customer hands cash to an agent, who credits the customer's wallet from the
 * agent's float. The money moves through the transfer engine like any other transfer (one
 * database transaction, row locks, balanced journal, AML screening, idempotency) — this module
 * only decides who may do it and to whom.
 *
 * Rules: the actor's own partner must be an ACTIVE agent; the recipient must be a customer
 * wallet in the agent's own country and currency (cash-in is domestic).
 */

export interface CashInInput {
  /** Phone number or e-mail of the customer's BI-Rem account. */
  readonly customer: string;
  /** Amount in major units as typed, e.g. "10 000" or "25.50". */
  readonly amount: string;
}

export const CASH_IN_KEY_PATTERN =
  /^cashin-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Resolves the float, the customer and the price. Moves nothing. */
export async function planCashIn(ctx: ActionContext, input: CashInInput) {
  const partner = await getPartner(ctx);
  if (partner.type !== 'AGENT') {
    throw new AppError('FORBIDDEN', 'Cash-in is available to agents only');
  }
  if (partner.status !== 'ACTIVE') {
    throw new AppError('INVALID_STATE', 'Cash-in is available once your agent account is active');
  }
  const float = (await listMyWallets(ctx)).find((wallet) => wallet.currency === partner.currency);
  if (!float) throw new AppError('INVALID_STATE', 'Your float wallet is not ready yet');

  let amount: bigint;
  try {
    amount = parseMoney(input.amount, float.currency);
  } catch {
    throw new AppError('VALIDATION', 'Enter a valid amount', {
      fieldErrors: { amount: [`Enter an amount in ${float.currency}`] },
    });
  }
  if (amount <= 0n) {
    throw new AppError('VALIDATION', 'Enter an amount greater than zero', {
      fieldErrors: { amount: ['Must be greater than zero'] },
    });
  }

  const recipient = { kind: 'WALLET' as const, identifier: input.customer };
  let preview;
  try {
    preview = await previewTransfer(ctx, { senderWalletId: float.id, recipient, amount });
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') {
      throw new AppError('NOT_FOUND', 'No BI-Rem customer matches this phone number or e-mail', {
        fieldErrors: { customer: ['No customer found'] },
      });
    }
    throw error;
  }
  if (preview.plan.recipient.walletType !== 'CUSTOMER') {
    throw new AppError('VALIDATION', 'Cash-in credits customer wallets only', {
      fieldErrors: { customer: ['This is not a customer account'] },
    });
  }
  if (preview.plan.international) {
    throw new AppError(
      'UNSUPPORTED',
      `Cash-in is domestic: this customer is not in ${partner.countryCode} (${partner.currency})`,
      { fieldErrors: { customer: ['Customer is in another country or currency'] } },
    );
  }
  return { partner, float, amount, recipient, preview };
}

/**
 * Executes a cash-in. `idempotencyKey` is minted by the server with the preview, so confirming
 * twice returns the first transfer instead of debiting the float again.
 */
export async function executeCashIn(
  ctx: ActionContext,
  input: CashInInput & { readonly idempotencyKey: string },
) {
  if (!CASH_IN_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new AppError('VALIDATION', 'This cash-in has expired. Review it again.');
  }
  const { float, amount, recipient } = await planCashIn(ctx, input);
  return createTransfer(ctx, {
    senderWalletId: float.id,
    recipient,
    amount,
    idempotencyKey: input.idempotencyKey,
    note: 'Cash-in at agent',
  });
}
