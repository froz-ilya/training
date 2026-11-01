import { learnStep, type SessionSet } from '../../lib/coach/strength';
import type { SetComparison } from '../../lib/coach/compare';
import { isTimed } from '../../lib/coach/overview';
import { fmtKg, fmtSet } from '../../lib/coach/text';
import { fmtNumber, t } from '../../lib/i18n.svelte';
import { fmtDuration } from '../../lib/workout/format';
import { weightStep } from '../../lib/workout/steps';
import type { Exercise, ExerciseSettings, Load } from '../../lib/types';

type Numbers = Pick<SessionSet, 'weightKg' | 'reps' | 'seconds'> & { level?: number };

export function fmtLevel(level: number): string {
  return t('workout.levelShort', { n: fmtNumber(level) });
}

/**
 * Table form of a set, without units: "80 × 7", "+10 × 8", "× 12", "Lv. 12 × 10", "Lv. 12 +5 × 10",
 * "1:40" or "+5 × 1:40". The level form may wrap in a narrow column, so it only breaks after the level.
 */
export function fmtCompact(set: Numbers, load: Load): string {
  if (load === 'time') {
    const time = fmtDuration(set.seconds ?? 0);
    return set.weightKg > 0 ? `+${fmtNumber(set.weightKg)} × ${time}` : time;
  }
  const reps = fmtNumber(set.reps);
  if (load === 'body') {
    const added = set.weightKg > 0 ? `+${fmtNumber(set.weightKg)} × ${reps}` : `× ${reps}`;
    return set.level === undefined ? added : `${fmtLevel(set.level)} ${added.replaceAll(' ', '\u00a0')}`;
  }
  return `${fmtNumber(set.weightKg)} × ${reps}`;
}

/** The weight column: a bodyweight set with nothing added shows its level, or else has nothing to show. */
export function weightCell(weightKg: number, load: Load, level?: number): string {
  if (load !== 'body') return fmtNumber(weightKg);
  if (weightKg > 0) return `+${fmtNumber(weightKg)}`;
  return level === undefined ? '–' : fmtLevel(level);
}

/** The level under the weight column's number, for a set that has both. */
export function levelNote(weightKg: number, load: Load, level?: number): string | null {
  return load === 'body' && weightKg > 0 && level !== undefined ? fmtLevel(level) : null;
}

/** The weight column's heading, which names what its cells show in this exercise. */
export function weightHeading(sets: Pick<Numbers, 'weightKg' | 'level'>[], load: Load, levels: boolean): string {
  if (load !== 'body') return t('workout.col.kg');
  const added = sets.some((s) => s.weightKg > 0);
  const anyLevel = sets.some((s) => s.level !== undefined);
  if (added) return t(anyLevel ? 'workout.col.addedLevel' : 'workout.col.added');
  return t(levels || anyLevel ? 'workout.col.level' : 'workout.col.added');
}

/** A planned set in words: fmtSet with what it leaves out, "Lv. 12 · 10 reps" or "+5 kg × 1:40". */
export function fmtPlanned(set: Numbers, load: Load): string {
  const added = isTimed(set, load) && set.weightKg > 0 ? `+${fmtKg(set.weightKg)} × ` : '';
  const text = added + fmtSet(set, load);
  return set.level === undefined ? text : `${fmtLevel(set.level)} · ${text}`;
}

export function signed(n: number): string {
  return `${n > 0 ? '+' : '−'}${fmtNumber(Math.abs(n))}`;
}

/** What changed against the same set last time: "+2.5 kg", "−1", or both. */
export function changeText(change: SetComparison): string {
  const parts: string[] = [];
  if (change.deltaKg) parts.push(t('workout.deltaKg', { delta: signed(change.deltaKg) }));
  if (change.deltaReps) parts.push(signed(change.deltaReps));
  if (change.deltaSeconds) parts.push(t('workout.deltaSeconds', { delta: signed(change.deltaSeconds) }));
  return parts.join(', ') || t('workout.deltaSame');
}

/** Whole percent, with a decimal under 1% so a small change never reads as 0. */
export function percentValue(percent: number): number {
  const size = Math.abs(percent);
  return size < 1 ? Math.round(size * 10) / 10 : Math.round(size);
}

/**
 * A set not checked off yet that still holds last time's numbers: those show what to beat, so it
 * reads as a plan until it's changed or checked.
 */
export function isPlan(set: Numbers & { done: boolean }, previous: Numbers | undefined): boolean {
  if (set.done || !previous) return false;
  return (
    set.weightKg === previous.weightKg &&
    set.reps === previous.reps &&
    (set.seconds ?? 0) === (previous.seconds ?? 0) &&
    set.level === previous.level
  );
}

/** The session a table row is held against: none when a machine or gym change lies between the two. */
export function comparableBefore<T extends { date: string }>(session: T, before: T | undefined, baselines: { date: string }[]): T | undefined {
  // A session on the day of a change already counts as after it, like sinceBaseline.
  return before && baselines.some((b) => before.date < b.date && b.date <= session.date) ? undefined : before;
}

/** The step this user moves in when last time's weights show it, like 0.625 on some cables. */
export function stepFor(exercise: Exercise | undefined, settings: ExerciseSettings | undefined, lastWeights: number[]): number {
  return settings?.stepKg || learnStep(lastWeights) || weightStep(exercise, settings);
}
