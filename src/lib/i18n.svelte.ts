import { catalogs, type Messages, type MsgKey } from './i18n/messages';
import type { UiLang, UiLangSetting } from './types';

/**
 * Interface language. Text lives in src/lib/i18n/messages/<area>.ts, in English, German and
 * Russian side by side; `t('settings.title')` picks the current language and re-renders when it
 * changes.
 */
const LOCALES: Record<UiLang, string> = { en: 'en-GB', de: 'de-DE', ru: 'ru-RU' };

/** The current language. */
export const i18n = $state({ lang: 'en' as UiLang });

export function setUiLang(lang: UiLang): void {
  i18n.lang = lang;
}

/** 'auto' follows the phone's language, English when the app doesn't have that language. */
export function resolveUiLang(choice: UiLangSetting | undefined, deviceLang: string | undefined): UiLang {
  if (choice === 'en' || choice === 'de' || choice === 'ru') return choice;
  const device = deviceLang?.toLowerCase() ?? '';
  if (device.startsWith('de')) return 'de';
  if (device.startsWith('ru')) return 'ru';
  return 'en';
}

/** BCP 47 locale for dates, times and numbers. */
export function locale(): string {
  return LOCALES[i18n.lang];
}

export function fmtNumber(n: number): string {
  return n.toLocaleString(locale(), { maximumFractionDigits: 3 });
}

type Placeholders<S> = S extends `${string}{${infer P}}${infer R}` ? P | Placeholders<R> : never;
type ParamValue = string | number;
type ParamsOf<S> = [Placeholders<S>] extends [never] ? [] : [params: Record<Placeholders<S>, ParamValue>];

/** Keys with plural forms: `common.sets` for `common.sets.one` + `common.sets.other`. */
export type PluralKey = MsgKey extends infer K ? (K extends `${infer B}.other` ? B : never) : never;
type PluralMsg<B extends PluralKey> = Messages[`${B}.other` & MsgKey];
type PluralArgs<B extends PluralKey> = [Exclude<Placeholders<PluralMsg<B>>, 'n'>] extends [never]
  ? []
  : [params: Record<Exclude<Placeholders<PluralMsg<B>>, 'n'>, ParamValue>];

const PLACEHOLDER = /\{(\w+)\}/g;

function fill(text: string, params: Record<string, ParamValue> | undefined): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (slot, name: string) => {
    const value = params[name];
    return value === undefined ? slot : typeof value === 'number' ? fmtNumber(value) : value;
  });
}

function message(lang: UiLang, key: MsgKey): string {
  return catalogs[lang][key];
}

/** Numbers in `params` are formatted for the language: pass a string for years, ids and the like. */
export function t<K extends MsgKey>(key: K, ...[params]: ParamsOf<Messages[K]>): string {
  return fill(message(i18n.lang, key), params);
}

const pluralRules = new Map<UiLang, Intl.PluralRules>();

/** `tn('common.sets', 3)` → "3 sets". Russian adds `.few` and `.many` forms next to `.one`. */
export function tn<B extends PluralKey>(key: B, n: number, ...[params]: PluralArgs<B>): string {
  const lang = i18n.lang;
  let rules = pluralRules.get(lang);
  if (!rules) pluralRules.set(lang, (rules = new Intl.PluralRules(LOCALES[lang])));
  const forms = catalogs[lang] as Record<string, string>;
  const text = forms[`${key}.${rules.select(n)}`] ?? forms[`${key}.other`];
  return fill(text, { ...(params as Record<string, ParamValue> | undefined), n });
}

export type Part = { text: string; slot?: undefined } | { slot: string; text?: undefined };

/** For a sentence with markup in it: leftover placeholders come back as slots to render. */
export function tParts(key: MsgKey, params?: Record<string, ParamValue>): Part[] {
  const parts: Part[] = [];
  for (const [i, piece] of fill(message(i18n.lang, key), params).split(PLACEHOLDER).entries()) {
    if (i % 2) parts.push({ slot: piece });
    else if (piece) parts.push({ text: piece });
  }
  return parts;
}
