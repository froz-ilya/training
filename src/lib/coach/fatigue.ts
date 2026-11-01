import type { Exercise, Muscle } from '../types';
import { effectiveSets, isMeasured, type PriorWork, type SessionSet } from './strength';

/**
 * A muscle that has already worked comes out weaker, which isn't lost strength. This counts the hard
 * sets done earlier in a workout that hit the muscles an exercise needs; position.ts turns the count
 * into an expected loss. Worked out from the stored sets on reading, and never stored.
 */

/**
 * What a set counts for when it hits the muscle only as a helper. A starting value: helpers do real
 * work but aren't taken near their limit, so half a set. It also covers the other way round, a muscle
 * trained directly before an exercise that uses it only to help: triceps work tires a chest press
 * partly, and only when `helpers` says the press needs them.
 */
export const HELPER_WEIGHT = 0.5;

/** A set in a workout, from the logger, from history or from a plan. `entry` is its exercise card. */
export interface WorkoutRow extends SessionSet {
  exerciseId: string;
  entry: number;
  order?: number;
}

type Worked = Pick<Exercise, 'muscle' | 'helpers'>;

/** What a set of `earlier` counts for against `target`, and the muscle it tired. */
function overlap(target: Worked, earlier: Worked): { weight: number; muscle: Muscle } | null {
  if (earlier.muscle === target.muscle) return { weight: 1, muscle: target.muscle };
  if (earlier.helpers?.includes(target.muscle)) return { weight: HELPER_WEIGHT, muscle: target.muscle };
  if (target.helpers?.includes(earlier.muscle)) return { weight: HELPER_WEIGHT, muscle: earlier.muscle };
  return null;
}

/**
 * The hard sets in `rows` above card `entry` that hit `target`, or null when none did. Warm-ups don't
 * count, nor do ramp-up sets stored as work (see effectiveSets()) or sets with no result. Pass the
 * rows that count for the purpose: only done ones for what has happened, all of them for a plan.
 */
export function priorWork(
  target: Worked,
  rows: WorkoutRow[],
  entry: number,
  exercises: ReadonlyMap<string, Exercise>,
  body: number,
): PriorWork | null {
  const earlier = new Map<string, WorkoutRow[]>();
  const sorted = rows.filter((r) => r.entry < entry).sort((a, b) => a.entry - b.entry || (a.order ?? 0) - (b.order ?? 0));
  for (const row of sorted) earlier.set(row.exerciseId, [...(earlier.get(row.exerciseId) ?? []), row]);

  const perMuscle = new Map<Muscle, number>();
  for (const [id, sets] of earlier) {
    const exercise = exercises.get(id);
    const hit = exercise && overlap(target, exercise);
    if (!hit) continue;
    const hard = effectiveSets(sets, exercise.load, body).filter((s) => s.kind === 'work' && isMeasured(s));
    if (hard.length) perMuscle.set(hit.muscle, (perMuscle.get(hit.muscle) ?? 0) + hard.length * hit.weight);
  }
  if (!perMuscle.size) return null;
  const sets = [...perMuscle.values()].reduce((sum, n) => sum + n, 0);
  const [muscle] = [...perMuscle].reduce((most, next) => (next[1] > most[1] ? next : most));
  return { sets, muscle };
}
