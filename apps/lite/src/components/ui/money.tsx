import { cn } from '@/lib/cn';
import { formatMoney } from '@/server/money';

/**
 * Formats minor units for display: `<Money amount={125000n} currency="XAF" />` → `125 000 XAF`.
 * Accepts `bigint` (server) or its string form (after `serialize()`, in Client Components).
 */
export function Money({
  amount,
  currency,
  signed = false,
  withCode = true,
  className,
}: {
  amount: bigint | string;
  currency: string;
  /** Prefix positive amounts with `+` and colour by sign (statements). */
  signed?: boolean;
  withCode?: boolean;
  className?: string;
}) {
  const value = typeof amount === 'string' ? BigInt(amount) : amount;
  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        signed && value > 0n && 'text-success',
        signed && value < 0n && 'text-danger',
        className,
      )}
    >
      {formatMoney(value, currency, { signed, withCode })}
    </span>
  );
}
