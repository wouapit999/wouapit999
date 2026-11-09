import Link from 'next/link';

import {
  CEMAC_COUNTRY_CODES,
  COUNTRIES,
  CURRENCIES,
  FUTURE_COUNTRY_CODES,
  PALOP_COUNTRY_CODES,
  type CountryCode,
} from '@bi-rem/shared/constants';

import { Money } from '@/components/money';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { type MessageKey, type Translator, createTranslator } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';
import { PAGES } from '@/lib/routes';

const FEATURES = [
  { key: 'fees', icon: '%' },
  { key: 'mobile', icon: '☎' },
  { key: 'security', icon: '🔒' },
] as const;

const REGIONS: ReadonlyArray<{ labelKey: MessageKey; codes: readonly CountryCode[] }> = [
  { labelKey: 'landing.countries.region.CEMAC', codes: CEMAC_COUNTRY_CODES },
  { labelKey: 'landing.countries.region.PALOP', codes: PALOP_COUNTRY_CODES },
  { labelKey: 'landing.countries.region.FUTURE', codes: FUTURE_COUNTRY_CODES },
];

export default async function LandingPage() {
  const t = createTranslator(await getRequestLocale());

  return (
    <>
      <section className="bg-gradient-to-b from-brand-50 to-surface dark:from-brand-950 dark:to-surface">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[3fr_2fr] lg:py-24">
          <div className="space-y-6">
            <Badge tone="gold">{t('footer.phase')}</Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
              {t('landing.hero.title')}
            </h1>
            <p className="max-w-xl text-lg text-fg-muted">{t('landing.hero.subtitle')}</p>
            <div className="flex flex-wrap gap-3">
              <Link href={PAGES.register} className={buttonClasses('primary', 'lg')}>
                {t('landing.hero.cta')}
              </Link>
              <Link href={PAGES.login} className={buttonClasses('secondary', 'lg')}>
                {t('landing.hero.secondary')}
              </Link>
            </div>
          </div>
          <ExampleQuote t={t} />
        </div>
      </section>

      <section
        className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6"
        aria-labelledby="features-title"
      >
        <h2 id="features-title" className="text-2xl font-semibold tracking-tight">
          {t('landing.features.title')}
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.key}>
              <span
                aria-hidden="true"
                className="grid h-10 w-10 place-items-center rounded-lg bg-brand-100 text-lg text-brand-800 dark:bg-brand-900 dark:text-brand-100"
              >
                {feature.icon}
              </span>
              <h3 className="mt-4 text-lg font-semibold">
                {t(`landing.features.${feature.key}.title`)}
              </h3>
              <p className="mt-2 text-sm text-fg-muted">
                {t(`landing.features.${feature.key}.body`)}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-surface-muted" aria-labelledby="countries-title">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="countries-title" className="text-2xl font-semibold tracking-tight">
            {t('landing.countries.title')}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">{t('landing.countries.subtitle')}</p>
          <div className="mt-8 grid gap-8 lg:grid-cols-3">
            {REGIONS.map((region) => (
              <div key={region.labelKey}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
                  {t(region.labelKey)}
                </h3>
                <ul className="space-y-2">
                  {region.codes.map((code) => {
                    const country = COUNTRIES[code];
                    const currency = CURRENCIES[country.currency];
                    return (
                      <li
                        key={code}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <span aria-hidden="true" className="w-7 font-mono text-xs text-fg-subtle">
                            {code}
                          </span>
                          <span className="font-medium">{country.name}</span>
                        </span>
                        <span className="flex items-center gap-2 text-xs text-fg-muted">
                          <span title={`${t('landing.countries.currency')}: ${currency.name}`}>
                            {currency.code}
                          </span>
                          <span title={t('landing.countries.dialCode')}>
                            +{country.callingCode}
                          </span>
                          <Badge tone={country.availability === 'LIVE' ? 'success' : 'neutral'}>
                            {country.availability === 'LIVE' ? t('badge.live') : t('badge.future')}
                          </Badge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function ExampleQuote({ t }: { t: Translator }) {
  // Illustrative amounts only (minor units, as strings). Live FX arrives with the transfers phase.
  const send = <Money amount="100000" currency="XAF" />;
  const receive = <Money amount="14250000" currency="AOA" />;
  return (
    <Card className="self-center border-brand-200 dark:border-brand-800">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-200">
        {t('landing.example.title')}
      </p>
      <dl className="mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <dt className="text-sm text-fg-muted">XAF</dt>
          <dd className="text-2xl font-semibold tabular-nums">{send}</dd>
        </div>
        <div aria-hidden="true" className="h-px bg-border" />
        <div className="flex items-center justify-between">
          <dt className="text-sm text-fg-muted">AOA</dt>
          <dd className="text-2xl font-semibold tabular-nums text-brand-700 dark:text-brand-200">
            {receive}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-fg-subtle">{t('landing.example.disclaimer')}</p>
    </Card>
  );
}
