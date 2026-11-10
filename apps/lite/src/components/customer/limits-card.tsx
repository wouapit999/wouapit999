import { usedPercent } from '@/app/app/_lib/display';
import { KYC_TIER_SHORT, labelFor } from '@/app/app/_lib/labels';
import { Money } from '@/components/ui';

interface LimitNumbers {
  readonly perTransaction: bigint;
  readonly daily: bigint;
  readonly monthly: bigint;
  readonly remainingToday: bigint;
  readonly remainingThisMonth: bigint;
}

function Meter({
  label,
  limit,
  remaining,
  currency,
}: {
  label: string;
  limit: bigint;
  remaining: bigint;
  currency: string;
}) {
  const percent = usedPercent(limit, remaining);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium text-fg">{label}</span>
        <span className="text-fg-muted">
          <Money amount={remaining} currency={currency} /> left of{' '}
          <Money amount={limit} currency={currency} />
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label}: ${percent}% used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className={`h-full rounded-full ${percent >= 90 ? 'bg-danger' : percent >= 70 ? 'bg-gold-500' : 'bg-accent'}`}
          style={{ width: `${Math.max(percent, percent > 0 ? 3 : 0)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The customer's transfer limits and what is left of them. Limits are defined in USD; the
 * amounts shown are today's equivalents in the customer's own currency, so they are approximate.
 */
export function LimitsSummary({
  tier,
  international,
  currency,
  local,
}: {
  tier: string;
  international: boolean;
  currency: string;
  local: LimitNumbers;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        {labelFor(KYC_TIER_SHORT, tier)} allows up to{' '}
        <Money amount={local.perTransaction} currency={currency} className="font-medium text-fg" />{' '}
        per transfer.{' '}
        {international
          ? 'International transfers are enabled.'
          : 'International transfers need identity verification.'}
      </p>
      <Meter
        label="Today"
        limit={local.daily}
        remaining={local.remainingToday}
        currency={currency}
      />
      <Meter
        label="This month"
        limit={local.monthly}
        remaining={local.remainingThisMonth}
        currency={currency}
      />
      <p className="text-xs text-fg-subtle">
        Limits are set in US dollars; amounts in {currency} are approximate equivalents at
        today&apos;s rate. Top-ups do not count towards them.
      </p>
    </div>
  );
}
