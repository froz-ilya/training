import { daysBetween } from '../dates';
import type { Exercise } from '../types';
import { workedExercises } from './budget';
import type { RotationWorkout } from './next';

/**
 * Exercises marked Sometimes: hard ones the user wants to do now and then, however much they'd rather
 * skip them. The rotation forgets what it hasn't seen lately, so these go by the date they were last
 * done instead. Nothing here is stored.
 */

/** A starting value: how long a marked exercise rests, and how long it can wait before it's due. */
export const SOMETIMES_DAYS = 21;

/** A marked exercise that's due, as the plan has it. */
export interface SometimesPick {
  exerciseId: string;
  /** The date it was last done; none when it never was. */
  last?: string;
  /** The filler it took the place of; none when it went on top or was there already. */
  replaced?: string;
}

export interface SometimesState {
  /** Marked exercises to bring in: longest waiting first, what was never done before anything else. */
  due: string[];
  /** Marked exercises done lately, which stay out of the plan until they're due. */
  resting: Set<string>;
  lastDone: Map<string, string>;
}

/** Where each marked exercise stands. It reads all of `workouts`, so a long wait never drops out of sight. */
export function sometimesState(
  workouts: RotationWorkout[],
  exercises: Map<string, Exercise>,
  marked: ReadonlySet<string>,
  avoid: ReadonlySet<string>,
  today: string,
): SometimesState {
  const lastDone = new Map<string, string>();
  for (const workout of workouts) {
    for (const id of workedExercises(workout, exercises)) if (marked.has(id)) lastDone.set(id, workout.date);
  }
  const usable = [...marked].filter((id) => exercises.has(id) && !avoid.has(id));
  const isDue = (id: string) => {
    const last = lastDone.get(id);
    return last === undefined || daysBetween(last, today) >= SOMETIMES_DAYS;
  };
  return {
    due: usable.filter(isDue).sort((a, b) => (lastDone.get(a) ?? '').localeCompare(lastDone.get(b) ?? '')),
    resting: new Set(usable.filter((id) => !isDue(id))),
    lastDone,
  };
}
