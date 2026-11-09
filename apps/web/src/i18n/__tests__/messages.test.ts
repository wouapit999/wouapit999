import { describe, expect, it } from 'vitest';

import { MESSAGES, SUPPORTED_LOCALES, createTranslator, interpolate } from '@/i18n';
import { en } from '@/i18n/messages/en';

describe('message catalogues', () => {
  const keys = Object.keys(en).sort();

  it.each(SUPPORTED_LOCALES)(
    '%s declares exactly the English keys with non-empty values',
    (locale) => {
      const catalogue = MESSAGES[locale];
      expect(Object.keys(catalogue).sort()).toEqual(keys);
      for (const key of keys) {
        expect(catalogue[key as keyof typeof en].trim().length, `${locale}.${key}`).toBeGreaterThan(
          0,
        );
      }
    },
  );

  it.each(SUPPORTED_LOCALES)('%s keeps the same placeholders as English', (locale) => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of keys) {
      const typedKey = key as keyof typeof en;
      expect(placeholders(MESSAGES[locale][typedKey]), `${locale}.${key}`).toEqual(
        placeholders(en[typedKey]),
      );
    }
  });

  it('interpolates values and leaves unknown placeholders untouched', () => {
    expect(interpolate('Hello {name}, {missing}', { name: 'Ada' })).toBe('Hello Ada, {missing}');
    const t = createTranslator('fr');
    expect(t('footer.rights', { year: 2026 })).toContain('2026');
  });
});
