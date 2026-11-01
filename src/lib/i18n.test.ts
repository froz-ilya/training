import { afterEach, describe, expect, it } from 'vitest';
import { fmtNumber, i18n, locale, resolveUiLang, setUiLang, t, tn, tParts } from './i18n.svelte';
import { catalogs } from './i18n/messages';

afterEach(() => setUiLang('en'));

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catalogs', () => {
  const keys = Object.keys(catalogs.en) as (keyof typeof catalogs.en)[];

  it('German has exactly the English keys', () => {
    expect(Object.keys(catalogs.de).sort()).toEqual([...keys].sort());
  });

  it('Russian has every English key', () => {
    const ru = Object.keys(catalogs.ru);
    for (const key of keys) expect(ru, key).toContain(key);
  });

  it('Russian adds only plural forms, each next to a plural message', () => {
    const extra = Object.keys(catalogs.ru).filter((key) => !(key in catalogs.en));
    for (const key of extra) {
      expect(key, key).toMatch(/\.(few|many)$/);
      expect(keys, key).toContain(key.replace(/(few|many)$/, 'other'));
    }
  });

  it('Russian plurals have all their forms', () => {
    const ru = catalogs.ru as Record<string, string>;
    for (const key of keys) {
      const base = key.replace(/other$/, '');
      // An id can be called "other" too; only pairs with `.one` are plurals.
      if (!key.endsWith('.other') || !(`${base}one` in catalogs.en)) continue;
      for (const form of ['one', 'few', 'many']) expect(ru[`${base}${form}`], `${base}${form}`).toBeTruthy();
    }
  });

  it('no message is empty', () => {
    for (const catalog of Object.values(catalogs)) {
      for (const [key, text] of Object.entries(catalog)) expect(text.trim(), key).not.toBe('');
    }
  });

  it('every language uses the same placeholders', () => {
    for (const key of keys) {
      expect(placeholders(catalogs.de[key]), key).toEqual(placeholders(catalogs.en[key]));
      expect(placeholders(catalogs.ru[key]), key).toEqual(placeholders(catalogs.en[key]));
    }
  });

  it('Russian plural forms use the same placeholders as the English message', () => {
    const ru = catalogs.ru as Record<string, string>;
    for (const [key, text] of Object.entries(ru)) {
      if (key in catalogs.en) continue;
      const other = key.replace(/(few|many)$/, 'other') as keyof typeof catalogs.en;
      expect(placeholders(text), key).toEqual(placeholders(catalogs.en[other]));
    }
  });

  it('plural messages come in pairs', () => {
    for (const key of keys) {
      if (key.endsWith('.one')) expect(keys, key).toContain(key.replace(/one$/, 'other'));
    }
  });
});

describe('resolveUiLang', () => {
  it('uses a chosen language whatever the phone says', () => {
    expect(resolveUiLang('de', 'en-US')).toBe('de');
    expect(resolveUiLang('ru', 'de-DE')).toBe('ru');
    expect(resolveUiLang('en', 'ru-RU')).toBe('en');
  });

  it('auto follows the phone, English when the app lacks that language', () => {
    expect(resolveUiLang('auto', 'de-AT')).toBe('de');
    expect(resolveUiLang('auto', 'DE')).toBe('de');
    expect(resolveUiLang('auto', 'ru-RU')).toBe('ru');
    expect(resolveUiLang('auto', 'fr-FR')).toBe('en');
    expect(resolveUiLang('auto', undefined)).toBe('en');
  });

  it('treats a missing or unknown saved value as auto', () => {
    expect(resolveUiLang(undefined, 'ru-RU')).toBe('ru');
    expect(resolveUiLang('fr' as never, 'en-GB')).toBe('en');
  });
});

describe('t', () => {
  it('follows the current language', () => {
    expect(t('common.cancel')).toBe('Cancel');
    setUiLang('de');
    expect(i18n.lang).toBe('de');
    expect(t('common.cancel')).toBe('Abbrechen');
    setUiLang('ru');
    expect(t('common.cancel')).toBe('Отмена');
  });

  it('fills placeholders', () => {
    expect(t('settings.app.version', { version: '1.2' })).toBe('Version 1.2');
  });

  it('formats number params for the language', () => {
    expect(fmtNumber(1234)).toBe('1,234');
    expect(fmtNumber(34.875)).toBe('34.875');
    setUiLang('de');
    expect(locale()).toBe('de-DE');
    expect(fmtNumber(12345)).toBe('12.345');
    expect(fmtNumber(27.5)).toBe('27,5');
  });
});

describe('tn', () => {
  it('picks singular and plural', () => {
    expect(tn('common.sets', 1)).toBe('1 set');
    expect(tn('common.sets', 0)).toBe('0 sets');
    expect(tn('common.sets', 2)).toBe('2 sets');
    setUiLang('de');
    expect(tn('common.sets', 1)).toBe('1 Satz');
    expect(tn('common.sets', 3)).toBe('3 Sätze');
  });

  it('uses all Russian forms', () => {
    setUiLang('ru');
    expect(tn('common.sets', 1)).toBe('1 подход');
    expect(tn('common.sets', 3)).toBe('3 подхода');
    expect(tn('common.sets', 5)).toBe('5 подходов');
    expect(tn('common.sets', 11)).toBe('11 подходов');
    expect(tn('common.sets', 21)).toBe('21 подход');
  });
});

describe('tParts', () => {
  it('returns text around the slots, in the order of the language', () => {
    catalogs.en['common.kg'] = '{n} of {all}';
    catalogs.de['common.kg'] = '{all}: {n}';
    try {
      expect(tParts('common.kg', { all: 6 })).toEqual([{ slot: 'n' }, { text: ' of 6' }]);
      setUiLang('de');
      expect(tParts('common.kg')).toEqual([{ slot: 'all' }, { text: ': ' }, { slot: 'n' }]);
    } finally {
      catalogs.en['common.kg'] = '{n} kg';
      catalogs.de['common.kg'] = '{n} kg';
    }
  });
});
