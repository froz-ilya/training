import { daysBetween } from '../dates';
import type { Exercise, StallAction, StallRecord } from '../types';
import { beatsAcrossSets } from './compare';
import { bestWork, IMPROVEMENT, tiesBest, type ExerciseStatus } from './status';
import type { RepRange, StrengthPoint } from './strength';

/** No new best after this many sessions or weeks: the choice didn't help. */
const OUTCOME_SESSIONS = 8;
const OUTCOME_WEEKS = 10;
/** Average days between sessions above which more frequent training comes first. */
const INFREQUENT_DAYS = 12;
/** Within this share of the rotation's own gap, an exercise can't really be done more often. */
const ROTATION_LIMIT = 1.25;
/** A chosen lighter week lasts this long. */
export const LIGHTER_WEEK_DAYS = 7;

/**
 * The outcome of a recorded choice: true once a later session makes progress on the sessions before
 * it, by a new best or a clear gain across its sets. False after long enough without one, undefined
 * while it's still too early to say.
 */
export function stallOutcome(record: StallRecord, points: StrengthPoint[], today: string): boolean | undefined {
  const before = points.filter((p) => p.date <= record.date);
  const after = points.filter((p) => p.date > record.date);
  if (!before.length) return undefined;
  const best = Math.max(...before.map((p) => p.value));
  const work = bestWork(before);
  if (after.some((p) => p.value > best * IMPROVEMENT || (work && tiesBest(p, best) && beatsAcrossSets(p, work)))) return true;
  if (after.length >= OUTCOME_SESSIONS || daysBetween(record.date, today) / 7 >= OUTCOME_WEEKS) return false;
  return undefined;
}

/** Past choices with their outcome filled in. Only the ones that changed. */
export function resolveOutcomes(records: StallRecord[], points: StrengthPoint[], today: string): StallRecord[] {
  const changed: StallRecord[] = [];
  for (const record of records) {
    if (record.helped !== undefined) continue;
    const helped = stallOutcome(record, points, today);
    if (helped !== undefined) changed.push({ ...record, helped });
  }
  return changed;
}

/** Average days between the latest sessions, or null with fewer than two. */
function recentGap(points: StrengthPoint[]): number | null {
  if (points.length < 2) return null;
  const recent = points.slice(-6);
  return daysBetween(recent[0].date, recent[recent.length - 1].date) / (recent.length - 1);
}

/** The exercise already comes round as often as the rotation does at this weekly frequency. */
export function atRotationLimit(points: StrengthPoint[], expectedGapDays: number | undefined): boolean {
  const gap = recentGap(points);
  return gap !== null && expectedGapDays !== undefined && gap <= expectedGapDays * ROTATION_LIMIT;
}

/**
 * The options, as choices rather than instructions. The default order keeps the lighter week low:
 * nothing shows it reliably ends a plateau. What has worked for this user goes first; what didn't
 * goes last.
 */
export function plateauOptions(points: StrengthPoint[], records: StallRecord[], expectedGapDays?: number): StallAction[] {
  const order: StallAction[] = ['repRange', 'frequency', 'swap', 'lighterWeek', 'maintain'];
  const gap = recentGap(points);
  if (atRotationLimit(points, expectedGapDays)) {
    order.splice(order.indexOf('frequency'), 1);
    order.splice(order.indexOf('maintain'), 0, 'frequency');
  } else if (gap !== null && gap >= INFREQUENT_DAYS) {
    order.splice(order.indexOf('frequency'), 1);
    order.unshift('frequency');
  }
  const score = (action: StallAction) =>
    records.reduce((sum, r) => sum + (r.action !== action || r.helped === undefined ? 0 : r.helped ? 1 : -1), 0);
  // Sorting is stable, so options with no track record keep the order above.
  return order.sort((a, b) => score(b) - score(a));
}

/** A rep range different enough from the current one to change the stimulus. */
export function alternateRange(current: RepRange): RepRange {
  return current.low < 10 ? { low: 10, high: 14 } : { low: 5, high: 8 };
}

/** Exercises for the same muscle, the same kind of exercise first. */
export function similarExercises(exercise: Exercise, all: Exercise[], limit = 3): Exercise[] {
  return all
    .filter((e) => e.id !== exercise.id && e.muscle === exercise.muscle && e.load === exercise.load)
    .sort((a, b) => Number(b.compound === exercise.compound) - Number(a.compound === exercise.compound))
    .slice(0, limit);
}

export function lighterWeekActive(records: StallRecord[], today: string): boolean {
  return records.some(
    (r) => r.action === 'lighterWeek' && daysBetween(r.date, today) >= 0 && daysBetween(r.date, today) < LIGHTER_WEEK_DAYS,
  );
}

export function needsOptions(status: ExerciseStatus): boolean {
  return status.state === 'stalled' && !status.maybeMachineChange;
}
