'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react';

import {
  type Locale,
  LOCALE_TAGS,
  type MessageValues,
  type MessageKey,
  createTranslator,
} from './index';

interface I18nContextValue {
  locale: Locale;
  /** BCP-47 tag for `Intl` APIs. */
  intlLocale: string;
  t: (key: MessageKey, values?: MessageValues) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const translator = useMemo(() => createTranslator(locale), [locale]);
  const t = useCallback<I18nContextValue['t']>(
    (key, values) => translator(key, values),
    [translator],
  );
  const value = useMemo<I18nContextValue>(
    () => ({ locale, intlLocale: LOCALE_TAGS[locale], t }),
    [locale, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within <I18nProvider>');
  }
  return context;
}

/** Shorthand for components that only need the translator. */
export function useT(): I18nContextValue['t'] {
  return useI18n().t;
}
