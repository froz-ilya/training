import { fmtKg } from './coach/text';
import { fmtDate } from './dates';
import { db } from './db/schema';
import { t } from './i18n.svelte';
import { saveSettings, settings } from './settings.svelte';
import type { BodyWeight } from './types';

/**
 * The weigh-in log, and what each part of the app reads from it.
 *
 * A chart or a record on an exercise reads each session at what the user weighed that day:
 * weightOn(). Comparisons (status, suggestions, new bests, the marks in the logger) hold every
 * session at the latest weight, in `settings.bodyWeightKg`. They ask whether the user did more, and
 * a kilo up or down from one morning to the next must not read as getting stronger or weaker.
 */

/** Sanity limit for what can be logged, so a typo can't flatten the chart. */
export const MAX_BODY_KG = 500;

/**
 * What the log says for a day: the latest weigh-in up to it, or the first one for a day before the
 * log begins. `log` runs oldest first.
 */
export function weightOn(log: BodyWeight[], date: string): number | undefined {
  let kg = log[0]?.kg;
  for (const entry of log) {
    if (entry.date > date) break;
    kg = entry.kg;
  }
  return kg;
}

/** Weight as typed, in kg, or null when it can't be logged. A comma works as a decimal mark. */
export function parseBodyKg(value: string): number | null {
  const kg = Number(value.trim().replace(',', '.'));
  return value.trim() && Number.isFinite(kg) && kg > 0 && kg <= MAX_BODY_KG ? kg : null;
}

/** The change since the weigh-in before the latest; empty until there are two. */
export function weightChangeText(log: BodyWeight[]): string {
  if (log.length < 2) return '';
  const latest = log[log.length - 1];
  const before = log[log.length - 2];
  const delta = Math.round((latest.kg - before.kg) * 10) / 10;
  if (!delta) return t('progress.weight.same', { date: fmtDate(before.date) });
  const change = `${delta > 0 ? '+' : '−'}${fmtKg(Math.abs(delta))}`;
  return t('progress.weight.since', { change, date: fmtDate(before.date) });
}

/** Keeps `settings.bodyWeightKg` on the latest weigh-in; 0 once the log is empty. */
export async function syncBodyWeight(): Promise<void> {
  const latest = await db.bodyWeights.orderBy('date').last();
  settings.bodyWeightKg = latest?.kg ?? 0;
  await saveSettings();
}

/** Logs a weigh-in. `movedFrom` is the day it was under before, when its date was changed. */
export async function saveBodyWeight(entry: BodyWeight, movedFrom?: string): Promise<void> {
  await db.transaction('rw', db.bodyWeights, async () => {
    if (movedFrom && movedFrom !== entry.date) await db.bodyWeights.delete(movedFrom);
    await db.bodyWeights.put(entry);
  });
  await syncBodyWeight();
}

export async function removeBodyWeight(date: string): Promise<void> {
  await db.bodyWeights.delete(date);
  await syncBodyWeight();
}
