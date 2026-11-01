import type { Load, Muscle } from '../types';
import { expectedLoss, lossFactor, positionFactor } from './position';
import { bodyKg, estimateSet, isMeasured, RAMP_SHARE, type PriorWork, type SessionSet, type StrengthPoint } from './strength';

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
  /** 'expected': lower, but no more than exercise order, earlier work or a tagged off day explains. */
  trend: Trend | 'expected';
  /** Change in estimated strength of work sets done so far, against the same number of previous work sets. */
  percent: number;
  /** What exercise order and earlier work predict against last time, negative when harder. */
  expectedPercent: number;
  position: number;
  previousPosition: number | null;
  /** The muscle whose earlier work explains an expected dip, when order alone doesn't. */
  fatigued?: Muscle;
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

const total = (values: number[]) => values.reduce((sum, v) => sum + v, 0);
const mean = (values: number[]) => total(values) / values.length;

/**
 * One more rep spread over several sets is small on paper, but at the same weights it's real
 * progress. Reps only: a second or two on a timer is noise, so time goes by the band. Takes sets
 * from the same places on both sides.
 */
function moreRepsAtSameWeight(current: { weightKg: number; reps: number }[], previous: { weightKg: number; reps: number }[]): boolean {
  const sameWeights = current.every((s, i) => s.weightKg === previous[i].weightKg);
  return sameWeights && total(current.map((s) => s.reps)) > total(previous.map((s) => s.reps));
}

/**
 * A session clearly beat an earlier one across its work sets, whatever its single best set did. This
 * is compareExercise()'s test, for sessions: sets are held against the same places, with the same
 * band and the same rule for reps. Only a set the earlier session has no match for needs to prove
 * itself: it adds to the total at RAMP_SHARE of the session's best or above, so a light extra set
 * earns nothing, while a lighter back-off set in a matched place still counts. A shorter session
 * falls short on the total. Nor does a fallen top set count, since moving effort from the first set
 * to the others isn't getting stronger.
 */
export function beatsAcrossSets(current: StrengthPoint, previous: StrengthPoint): boolean {
  const now = current.work ?? [];
  const before = previous.work ?? [];
  if (!now.length || !before.length) return false;
  if (current.value < previous.value * (1 - SAME_BAND / 100)) return false;
  const counted = now.filter((set, i) => i < before.length || set.estimate >= RAMP_SHARE * current.value);
  const ratio = total(counted.map((s) => s.estimate)) / total(before.map((s) => s.estimate));
  if (ratio > 1 + SAME_BAND / 100) return true;
  // Above 1 so that reps gained by moving earlier in the workout, which position cost removes, don't count.
  return ratio > 1 && now.length >= before.length && moreRepsAtSameWeight(now.slice(0, before.length), before);
}

export function compareExercise(
  current: SessionSet[],
  previous: SessionSet[],
  options: {
    position: number;
    previousPosition: number | null;
    cost: number;
    load: Load;
    bodyKg: number;
    offDay?: boolean;
    /** Earlier work today, and before this exercise in the session compared with. */
    priorWork?: PriorWork | null;
    previousPriorWork?: PriorWork | null;
  },
): ExerciseComparison | null {
  const { position, previousPosition, cost, load, bodyKg, offDay, priorWork, previousPriorWork } = options;
  const estimate = (set: SessionSet) => estimateSet(set, load, bodyKg);
  const done = workOnly(current).filter((s) => estimate(s) > 0);
  const before = workOnly(previous).filter((s) => estimate(s) > 0).slice(0, done.length);
  if (!done.length || !before.length) return null;

  // Sets from the same places on both sides, so a shorter day isn't compared with back-off sets.
  const matched = done.slice(0, before.length);
  if (!matched.every((s, i) => sameLevel(s, before[i]))) return null;
  const percent = round((mean(matched.map(estimate)) / mean(before.map(estimate)) - 1) * 100, 1);
  const percentOf = (factor: number) => (previousPosition === null ? 0 : round((factor - 1) * 100, 1));
  const reference = previousPosition ?? position;
  const orderPercent = percentOf(positionFactor(position, reference, cost));
  // Against the session compared with: the same work done first both times explains no dip.
  const loss = expectedLoss(position, cost, priorWork?.sets);
  const expectedPercent = percentOf(lossFactor(loss, expectedLoss(reference, cost, previousPriorWork?.sets)));

  let trend: ExerciseComparison['trend'] = 'same';
  let fatigued: Muscle | undefined;
  if (percent > SAME_BAND || moreRepsAtSameWeight(matched, before)) trend = 'up';
  else if (percent < -SAME_BAND) {
    const explained = expectedPercent < 0 && percent >= expectedPercent - SAME_BAND;
    trend = offDay || explained ? 'expected' : 'down';
    if (explained && expectedPercent < orderPercent) fatigued = priorWork?.muscle;
  }
  return { trend, percent, expectedPercent, position, previousPosition, ...(fatigued ? { fatigued } : {}) };
}
