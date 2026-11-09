import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Money } from '@/components/money';
import { I18nProvider } from '@/i18n/provider';

function renderWithLocale(ui: React.ReactElement, locale: 'en' | 'fr' | 'pt' = 'en') {
  return render(<I18nProvider locale={locale}>{ui}</I18nProvider>);
}

describe('<Money />', () => {
  it('formats exponent-0 currencies without decimals and keeps the raw value machine-readable', () => {
    renderWithLocale(<Money amount="125000" currency="XAF" />);
    const element = screen.getByText(/125,000/);
    expect(element.tagName).toBe('DATA');
    expect(element).toHaveAttribute('value', '125000 XAF');
    expect(element.textContent).not.toMatch(/\.\d/);
  });

  it('formats exponent-2 currencies from minor units', () => {
    renderWithLocale(<Money amount={1250075} currency="USD" />);
    expect(screen.getByText('$12,500.75')).toBeInTheDocument();
  });

  it('follows the active locale', () => {
    renderWithLocale(<Money amount="1250075" currency="EUR" />, 'fr');
    // French uses a narrow no-break space as the group separator and a comma decimal.
    const element = screen.getByText(
      (_, node) => node?.tagName === 'DATA' && /12.500,75/.test(node.textContent),
    );
    expect(element).toBeInTheDocument();
  });

  it('accepts a locale override and sign display', () => {
    renderWithLocale(<Money amount={-500n} currency="AOA" locale="en" signDisplay="always" />);
    expect(screen.getByText(/-.*5\.00/)).toBeInTheDocument();
  });

  it('rejects float-like amounts instead of silently rounding', () => {
    expect(() => renderWithLocale(<Money amount="12.5" currency="USD" />)).toThrow(
      /integer amount of minor units/,
    );
  });
});
