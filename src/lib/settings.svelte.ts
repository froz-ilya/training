import { db } from './db/schema';
import type { CustomTag, Settings, ThemeSetting, UiLangSetting } from './types';

export const defaultSettings: Settings = {
  id: 'main',
  uiLang: 'auto',
  exerciseLang: 'auto',
  theme: 'auto',
  bodyWeightKg: 0,
  workoutsPerWeek: 0,
  customTags: [],
  backupEvery: 14,
  lastBackupAt: 0,
  backupSnoozeUntil: 0,
};

export const settings = $state<Settings>({ ...defaultSettings });

const LANGUAGES: UiLangSetting[] = ['auto', 'en', 'de', 'ru'];
const THEMES: ThemeSetting[] = ['auto', 'light', 'dark'];

const count = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

/** Tags that can't be shown or stored are dropped; the rest keep their fields. */
function normalizeTags(value: unknown): CustomTag[] {
  if (!Array.isArray(value)) return [];
  const tags = value.filter((tag) => typeof tag?.id === 'string' && tag.id && typeof tag?.label === 'string' && tag.label.trim());
  return tags.map((tag) => ({ id: tag.id, label: tag.label, offDay: tag.offDay === true }));
}

/**
 * Saved settings as today's code reads them: anything missing or unknown takes its default, so
 * settings from older versions and old backups keep working. Fields this code doesn't know stay.
 */
export function normalizeSettings(saved: Partial<Settings> | null | undefined): Settings {
  const merged = { ...defaultSettings, ...saved, id: 'main' as const };
  return {
    ...merged,
    uiLang: LANGUAGES.includes(merged.uiLang) ? merged.uiLang : defaultSettings.uiLang,
    exerciseLang: LANGUAGES.includes(merged.exerciseLang) ? merged.exerciseLang : defaultSettings.exerciseLang,
    theme: THEMES.includes(merged.theme) ? merged.theme : defaultSettings.theme,
    bodyWeightKg: count(merged.bodyWeightKg, defaultSettings.bodyWeightKg),
    workoutsPerWeek: Math.min(7, Math.round(count(merged.workoutsPerWeek, defaultSettings.workoutsPerWeek))),
    customTags: normalizeTags(merged.customTags),
    backupEvery: count(merged.backupEvery, defaultSettings.backupEvery),
    lastBackupAt: count(merged.lastBackupAt, defaultSettings.lastBackupAt),
    backupSnoozeUntil: count(merged.backupSnoozeUntil, defaultSettings.backupSnoozeUntil),
  };
}

/** The row as this tab last read or wrote it: anything different in `settings` is this tab's change. */
let stored: Settings = { ...defaultSettings };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function loadSettings(): Promise<void> {
  const saved = await db.settings.get('main');
  if (saved) {
    stored = normalizeSettings(saved);
    Object.assign(settings, stored);
  }
}

/**
 * Writes only what this tab changed, onto the row as it is now. Another tab may have restored a
 * backup or changed a setting since this one read it, and that stays.
 */
export async function saveSettings(): Promise<unknown> {
  const current = $state.snapshot(settings) as Settings;
  const changes = Object.fromEntries(Object.entries(current).filter(([key, value]) => !same(value, stored[key as keyof Settings])));
  if (!Object.keys(changes).length) return;
  const row = await db.transaction('rw', db.settings, async () => {
    const merged = { ...normalizeSettings(await db.settings.get('main')), ...changes };
    await db.settings.put(merged);
    return merged;
  });
  // Fields this tab hasn't touched catch up with the row; a change made since the write stays.
  const fresh: Partial<Settings> = {};
  for (const key of Object.keys(row) as (keyof Settings)[]) {
    if (same(settings[key], stored[key])) Object.assign(fresh, { [key]: row[key] });
  }
  stored = row;
  Object.assign(settings, fresh);
}
