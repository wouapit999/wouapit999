import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES, isLocale } from '@bi-rem/shared/constants';

import { en, type MessageKey, type Messages } from './messages/en';
import { fr } from './messages/fr';
import { pt } from './messages/pt';

export type { MessageKey, Messages };
export { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale };
export type { Locale };

export const MESSAGES: Readonly<Record<Locale, Messages>> = { en, fr, pt };

export type MessageValues = Record<string, string | number>;

/** Replaces `{name}` placeholders. Unknown placeholders are left intact for easier debugging. */
export function interpolate(template: string, values?: MessageValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

export type Translator = (key: MessageKey, values?: MessageValues) => string;

/** Builds a translator for a locale. Catalogue completeness is enforced by the `Messages` type. */
export function createTranslator(locale: Locale): Translator {
  const messages = MESSAGES[locale];
  return (key, values) => interpolate(messages[key], values);
}

/** BCP-47 tags used for `Intl` formatting and the `<html lang>` attribute. */
export const LOCALE_TAGS: Readonly<Record<Locale, string>> = {
  en: 'en',
  fr: 'fr',
  pt: 'pt-PT',
};
