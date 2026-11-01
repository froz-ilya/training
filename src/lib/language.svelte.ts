import { resolveUiLang, setUiLang } from './i18n.svelte';
import { settings } from './settings.svelte';

/** Apply the interface language now, and again whenever the setting changes. */
export function initLanguage(): void {
  $effect.root(() => {
    $effect(() => {
      const lang = resolveUiLang(settings.uiLang, typeof navigator === 'undefined' ? undefined : navigator.language);
      setUiLang(lang);
      document.documentElement.lang = lang;
    });
  });
}
