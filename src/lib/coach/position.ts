import { daysBetween } from '../dates';
import type { StrengthPoint } from './strength';

/**
 * Where an exercise sits in a workout. Later exercises come out a little weaker, which is normal,
 * and so do exercises whose muscle has already worked, so numbers from different places are only
 * compared after allowing for that.
 *
 * Position is worked out from the stored `entry` numbers and earlier work from the stored sets
 * (fatigue.ts), so neither needs saving.
 */

/** Strength lost per position later in the workout, until a user's own history says otherwise. */
export const DEFAULT_POSITION_COST = 0.025;
const MAX_COST = 0.05;
/** Comparisons needed before a user's own cost replaces the default. */
const MIN_PAIRS = 30;
/** Position never explains more than this share of a difference, either way. */
const MAX_SHIFT = 0.1;
/** Sessions on each side that stand in for "around that time", which removes the general trend. */
const NEIGHBOURS = 4;
const MIN_NEIGHBOURS = 4;
const NEAR_DAYS = 60;
/** A single good or bad day counts for no more than this. */
const MAX_SWING = 0.15;

/**
 * Strength lost per hard set already done for the same muscle in the workout. A general, conservative
 * judgement, not a measured value: research on exercise order finds fewer reps when a muscle has
 * already worked, but gives no single figure. One rep in a set of about 10 is worth 2.5% of an
 * estimate, and the muscle rests between exercises, so this allows a bit over half a rep per set.
 * It isn't fitted to anyone. It isn't learned either: someone who always trains these muscles in the
 * same order has no fresh sessions to learn it from.
 */
export const FATIGUE_PER_SET = 0.015;
/**
 * Earlier work never explains more than this, about three reps in a set of 10. It sits under
 * MAX_SHIFT, so a bigger drop stays a drop however much was done first.
 */
export const MAX_FATIGUE = 0.075;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Workout id → entry number → 1-based position. Entries can have gaps after an exercise is removed. */
export function entryRanks(rows: { workoutId: string; entry: number }[]): Map<string, Map<number, number>> {
  const entries = new Map<string, Set<number>>();
  for (const { workoutId, entry } of rows) {
    const set = entries.get(workoutId);
    if (set) set.add(entry);
    else entries.set(workoutId, new Set([entry]));
  }
  const ranks = new Map<string, Map<number, number>>();
  for (const [workoutId, set] of entries) {
    ranks.set(workoutId, new Map([...set].sort((a, b) => a - b).map((entry, i) => [entry, i + 1])));
  }
  return ranks;
}

/** What an expected loss is worth against another. It never explains more than MAX_SHIFT, either way. */
export function lossFactor(loss: number, reference: number): number {
  return Math.min(1 + MAX_SHIFT, Math.max(1 - MAX_SHIFT, 1 - (loss - reference)));
}

/** What `position` is worth against `reference`: below 1 when later, above 1 when earlier. */
export function positionFactor(position: number, reference: number, cost: number): number {
  return lossFactor(cost * position, cost * reference);
}

/** The share of strength earlier work is expected to cost, from weighted sets (see priorWork()). */
export function fatigueLoss(priorSets: number): number {
  return Math.min(MAX_FATIGUE, priorSets * FATIGUE_PER_SET);
}

/**
 * The share of strength a place in a workout is expected to cost. Position and earlier work describe
 * the same tiredness from two sides, so this is the larger of them, never the sum.
 */
export function expectedLoss(position: number, cost: number, priorSets = 0): number {
  return Math.max(cost * (position - 1), fatigueLoss(priorSets));
}

/** Each value as if done at the exercise's usual place in a workout. Dates and order stay as they are. */
export function adjustPoints(points: StrengthPoint[], cost: number): StrengthPoint[] {
  const losses = points.flatMap((p) => (p.position === undefined ? [] : [expectedLoss(p.position, cost, p.priorSets)]));
  if (!losses.length) return points;
  const usual = median(losses);
  return points.map((p) => {
    if (p.position === undefined) return p;
    const factor = lossFactor(expectedLoss(p.position, cost, p.priorSets), usual);
    const work = p.work?.map((set) => ({ ...set, estimate: set.estimate / factor }));
    return { ...p, value: p.value / factor, ...(work ? { work } : {}) };
  });
}

/**
 * This user's cost per position. Each session is compared with the sessions around it, so getting
 * stronger over time doesn't read as an effect of position.
 */
export function learnPositionCost(pointsByExercise: StrengthPoint[][]): number {
  let pairs = 0;
  let sumDeltaSwing = 0;
  let sumDeltaSquared = 0;
  for (const points of pointsByExercise) {
    points.forEach((point, i) => {
      if (point.position === undefined) return;
      const near = [...points.slice(Math.max(0, i - NEIGHBOURS), i), ...points.slice(i + 1, i + 1 + NEIGHBOURS)].filter(
        (p) => p.position !== undefined && Math.abs(daysBetween(p.date, point.date)) <= NEAR_DAYS,
      );
      if (near.length < MIN_NEIGHBOURS) return;
      const delta = point.position - median(near.map((p) => p.position as number));
      if (delta === 0) return;
      const swing = Math.log(point.value / median(near.map((p) => p.value)));
      pairs += 1;
      sumDeltaSwing += delta * Math.max(-MAX_SWING, Math.min(MAX_SWING, swing));
      sumDeltaSquared += delta * delta;
    });
  }
  if (pairs < MIN_PAIRS) return DEFAULT_POSITION_COST;
  return Math.max(0, Math.min(MAX_COST, -sumDeltaSwing / sumDeltaSquared));
}
