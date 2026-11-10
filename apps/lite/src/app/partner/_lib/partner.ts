import 'server-only';

import { notFound } from 'next/navigation';

import { getPageContext } from '@/server/auth/session';
import { AppError } from '@/server/errors';
import { getPartner } from '@/server/partners';

/**
 * Entry point of every partner-portal page: checks the session server-side (role PARTNER) and
 * loads the partner the signed-in user belongs to. `getPartner` only ever returns the actor's
 * own partner — a partner id is never taken from the URL or a form.
 */
export async function getPartnerPage() {
  const { ctx, user } = await getPageContext('PARTNER');
  // A PARTNER login without a partner cannot use the portal; the layout explains why.
  if (!user.partnerId) notFound();
  try {
    const partner = await getPartner(ctx);
    return { ctx, user, partner };
  } catch (error) {
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
      notFound();
    }
    throw error;
  }
}

export type PartnerPage = Awaited<ReturnType<typeof getPartnerPage>>;

export const PARTNER_TYPE_LABELS = {
  PARTNER: 'API partner',
  MERCHANT: 'Merchant',
  AGENT: 'Agent',
} as const;

export const TRANSFER_TYPE_LABELS: Readonly<Record<string, string>> = {
  W2W: 'Wallet transfer',
  W2M: 'Merchant payment',
  W2A: 'Agent cash-out',
  INTERNATIONAL: 'International',
  TOPUP: 'Top-up',
};

export const TRANSFER_STATUS_LABELS: Readonly<Record<string, string>> = {
  PROCESSING: 'Processing',
  ON_HOLD: 'Under review',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  REJECTED: 'Not approved',
  REVERSED: 'Reversed',
};

/** `/partner/x?…` with the given parameters (empty ones dropped) — for filter and paging links. */
export function hrefWith(
  path: string,
  params: Readonly<Record<string, string | number | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && !(key === 'page' && value === 1)) {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}
