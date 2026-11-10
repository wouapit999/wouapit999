import { Alert } from '@/components/ui';

/**
 * Confirmation shown after an action whose own form disappears once it succeeds (the transfer
 * is reversed, the case is closed…). The action redirects back with `?notice=<code>`; only the
 * fixed messages below can be displayed, so a crafted link cannot put arbitrary text on a
 * back-office page.
 */
const NOTICES: Readonly<Record<string, string>> = {
  'provider-active': 'Provider enabled. Customers and partners can use it again.',
  'provider-inactive': 'Provider disabled. It is hidden from customers and partners.',
  'provider-maintenance': 'Provider set to maintenance.',
  'transfer-reversed':
    'Transfer reversed. Compensating journals were posted and the sender was refunded.',
  'transfer-refreshed': 'Status checked with the provider.',
  'kyc-approved': 'Case approved. The customer has been notified and their tier updated.',
  'kyc-rejected': 'Case rejected. The customer has been notified.',
  'kyc-resubmit_requested': 'Resubmission requested. The customer has been notified.',
  'case-released': 'Case released. The held transfer went ahead.',
  'case-rejected': 'Case rejected. The reserved funds were returned to the sender.',
  'case-closed': 'Case closed.',
  'sar-drafted': 'SAR draft saved.',
  'sar-filed': 'Report marked as filed. It can no longer be edited.',
  'partner-approved': 'Application approved. The partner is active and has a wallet.',
  'partner-rejected': 'Application rejected. The applicant has been notified.',
  'partner-active': 'Partner reactivated.',
  'partner-suspended': 'Partner suspended. Its portal and API keys are blocked.',
  'settlement-paid':
    'Settlement run complete: the accrued commission was credited to the partner wallet and marked paid.',
};

export function Notice({ code }: { code: string | undefined }) {
  const message = code ? NOTICES[code] : undefined;
  if (!message) return null;
  return (
    <Alert tone="success" className="mb-5">
      <span data-testid="notice">{message}</span>
    </Alert>
  );
}
