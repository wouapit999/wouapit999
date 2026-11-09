'use client';

import { type CurrencyCode, assertMinorUnits, formatMoney } from '@bi-rem/shared';

import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/cn';

export interface MoneyProps {
  /** Minor units (BIGINT) as bigint, safe integer or digit string — never a float. */
  amount: bigint | number | string;
  currency: CurrencyCode;
  /** Overrides the active UI locale for formatting. */
  locale?: string;
  signDisplay?: Intl.NumberFormatOptions['signDisplay'];
  className?: string;
}

/**
 * Formats a minor-unit amount with the active locale. Renders a `<data>` element so the exact
 * value stays machine-readable next to the localized display string.
 */
export function Money({ amount, currency, locale, signDisplay, className }: MoneyProps) {
  const { intlLocale } = useI18n();
  const minor = assertMinorUnits(amount);
  const display = formatMoney({ amount: minor, currency }, locale ?? intlLocale, {
    ...(signDisplay ? { signDisplay } : {}),
  });
  return (
    <data value={`${minor.toString()} ${currency}`} className={cn('tabular-nums', className)}>
      {display}
    </data>
  );
}
