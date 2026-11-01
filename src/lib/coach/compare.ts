import type { Load } from '../types';
import { positionFactor } from './position';
import { bodyKg, estimateSet, isMeasured, type SessionSet } from './strength';

/** Comparing today's sets with last time's, for the marks in the workout logger. */

export type Trend = 'up' | 'same' | 'down';

export interface SetComparison {
  trend: Trend;
  deltaKg: number;
  deltaReps: number;
  deltaSeconds: number;
  previous: SessionSet;
}

export interface ExerciseComparison {
  /** 'expected': lower, but no more than exercise order or a tagged off day explains. */
  trend: Trend | 'expected';
  /** Change in estimated strength of work sets done so far, against the same number of previous work sets. */
  percent: number;
  /** What exercise order alone predicts, negative when later. */
  expectedPercent: number;
  position: number;
  previousPosition: number | null;
}

/** A change within this many percent is ordinary day-to-day noise. */
const SAME_BAND = 1;
/** One set at a new weight says less than a whole exercise, so its band is wider. */
const SET_BAND = 2;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** Previous sets matched to current ones: warm-ups by order among warm-ups, work sets by order among work sets. */
export function pairSets(current: SessionSet[], previous: SessionSet[]): (SessionSet | undefined)[] {
  const warmups = previous.filter((s) => s.kind === 'warmup');
  const work = previous.filter((s) => s.kind === 'work');
  const seen = { warmup: 0, work: 0 };
  return current.map((set) => (set.kind === 'warmup' ? warmups : work)[seen[set.kind]++]);
}

/** Reps at one level say nothing about another. A set with no level recorded can still be compared. */
function sameLevel(a: SessionSet, b: SessionSet): boolean {
  return a.level === undefined || b.level === undefined || a.level === b.level;
}

/**
 * At equal weight more reps (or seconds) is up and fewer is down. At different weights estimated
 * strength decides, so a heavier set with far fewer reps isn't called better. Bodyweight exercises
 * count the body too, with the usual stand-in when no body weight is set. Null when there's no
 * previous set, the two are at different levels, or either set has no result.
 */
export function compareSet(
  current: SessionSet,
  previous: SessionSet | undefined,
  options: { load?: Load; bodyKg?: number } = {},
): SetComparison | null {
  const { load = 'weight', bodyKg: body } = options;
  if (!previous || !sameLevel(current, previous) || !isMeasured(current) || !isMeasured(previous)) return null;
  const deltaKg = round(current.weightKg - previous.weightKg, 3);
  const deltaReps = round(current.reps - previous.reps, 1);
  const deltaSeconds = (current.seconds ?? 0) - (previous.seconds ?? 0);
  const change = deltaKg === 0 ? deltaReps || deltaSeconds : strengthChange(current, previous, deltaKg, load, bodyKg(body));
  return { trend: change > 0 ? 'up' : change < 0 ? 'down' : 'same', deltaKg, deltaReps, deltaSeconds, previous };
}

/** Above 0 when `current` is clearly stronger, below when clearly weaker, 0 inside the band. */
function strengthChange(current: SessionSet, previous: SessionSet, deltaKg: number, load: Load, body: number): number {
  // A timed set's estimate is its time, which can't weigh added weight against it.
  if (load === 'time') return deltaKg;
  const now = estimateSet(current, load, body);
  const before = estimateSet(previous, load, body);
  // No estimate for a set with no weight on a weighted exercise: only the weight can tell.
  if (now <= 0 || before <= 0) return deltaKg;
  const percent = (now / before - 1) * 100;
  return Math.abs(percent) <= SET_BAND ? 0 : percent;
}

const workOnly = (sets: SessionSet[]) => sets.filter((s) => s.kind === 'work');

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

export function compareExercise(
  current: SessionSet[],
  previous: SessionSet[],
  options: { position: number; previousPosition: number | null; cost: number; load: Load; bodyKg: number; offDay?: boolean },
): ExerciseComparison | null {
  const { position, previousPosition, cost, load, bodyKg, offDay } = options;
  const estimate = (set: SessionSet) => estimateSet(set, load, bodyKg);
  const done = workOnly(current).filter((s) => estimate(s) > 0);
  const before = workOnly(previous).filter((s) => estimate(s) > 0).slice(0, done.length);
  if (!done.length || !before.length) return null;

  // Sets from the same places on both sides, so a shorter day isn't compared with back-off sets.
  const matched = done.slice(0, before.length);
  if (!matched.every((s, i) => sameLevel(s, before[i]))) return null;
  const percent = round((mean(matched.map(estimate)) / mean(before.map(estimate)) - 1) * 100, 1);
  const expectedPercent = previousPosition === null ? 0 : round((positionFactor(position, previousPosition, cost) - 1) * 100, 1);

  // One more rep spread over several sets is small on paper, but it's real progress.
  const sameWeights = matched.every((s, i) => s.weightKg === before[i].weightKg);
  const volume = (sets: SessionSet[]) => sets.reduce((sum, s) => sum + s.reps + (s.seconds ?? 0), 0);
  const moreAtSameWeight = sameWeights && volume(matched) > volume(before);

  let trend: ExerciseComparison['trend'] = 'same';
  if (percent > SAME_BAND || moreAtSameWeight) trend = 'up';
  else if (percent < -SAME_BAND) {
    trend = offDay || (expectedPercent < 0 && percent >= expectedPercent - SAME_BAND) ? 'expected' : 'down';
  }
  return { trend, percent, expectedPercent, position, previousPosition };
}
