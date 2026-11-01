import { leadingGroup } from '../catalog/groups';
import { daysBetween } from '../dates';
import type { Exercise } from '../types';
import { expectedGapDays } from './frequency';

/** A finished workout, newest last, as the rotation sees it. */
export interface RotationWorkout {
  id: string;
  date: string;
  exerciseIds: string[];
  /** Work sets per exercise. */
  workSets: Record<string, number>;
}

export interface PlannedType {
  key: string;
  exerciseIds: string[];
}

/** How far back the rotation looks. */
const WINDOW = 30;
const TYPE_LOOKBACK = 10;
const MIN_EXERCISES = 3;
const MAX_EXERCISES = 6;
const ANCHORS = 3;

/** A key per workout: the group it trained most, or '' with no known exercises. */
export function rotationKeys(workouts: RotationWorkout[], exercises: Map<string, Exercise>): string[] {
  return workouts.map((workout) => {
    const work = workout.exerciseIds.flatMap((id) => {
      const muscle = exercises.get(id)?.muscle;
      return muscle ? [{ muscle, sets: workout.workSets[id] ?? 0 }] : [];
    });
    return leadingGroup(work) ?? '';
  });
}

/** The type that usually follows the latest one; on a tie, the one left longest. */
export function nextKey(keys: string[]): string | null {
  const known = keys.filter(Boolean);
  if (!known.length) return null;
  const last = known[known.length - 1];
  const others = [...new Set(known)].filter((k) => k !== last);
  if (!others.length) return last;

  // A type done once in this window was a one-off, not part of the rotation.
  const seen = new Map<string, number>();
  for (const key of known) seen.set(key, (seen.get(key) ?? 0) + 1);
  const regular = others.filter((k) => (seen.get(k) ?? 0) > 1);
  const candidates = regular.length ? regular : others;

  const follows = new Map<string, number>();
  for (let i = 1; i < known.length; i++) {
    if (known[i - 1] === last) follows.set(known[i], (follows.get(known[i]) ?? 0) + 1);
  }
  const lastSeen = (key: string) => known.lastIndexOf(key);
  return [...candidates].sort((a, b) => {
    const diff = (follows.get(b) ?? 0) - (follows.get(a) ?? 0);
    return diff || lastSeen(a) - lastSeen(b);
  })[0];
}

/** The user's week, so the rotation can catch up with a type that has waited too long. */
export interface RotationPace {
  today: string;
  perWeek: number;
}

/** Types done more than once; one-offs aren't part of the rotation. */
function regularKeys(keys: string[]): string[] {
  const seen = new Map<string, number>();
  for (const key of keys) if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
  const regular = [...seen].filter(([, n]) => n > 1).map(([key]) => key);
  return regular.length ? regular : [...seen.keys()];
}

/** How many types the rotation goes through. */
export function rotationTypeCount(workouts: RotationWorkout[], exercises: Map<string, Exercise>): number {
  const usable = workouts.filter((w) => w.exerciseIds.some((id) => exercises.has(id))).slice(-WINDOW);
  return regularKeys(rotationKeys(usable, exercises)).length;
}

/**
 * The rotation's next type, unless another has clearly been left too long: past its usual wait at
 * this frequency, and by a whole workout's gap more than the rotation's choice.
 */
export function overdueKey(keys: string[], dates: string[], pace: RotationPace): string | null {
  const pick = nextKey(keys);
  if (pick === null) return null;
  const known = keys.filter(Boolean);
  const latest = known[known.length - 1];
  const regular = regularKeys(keys);
  const waited = (key: string) => daysBetween(dates[keys.lastIndexOf(key)], pace.today);
  const longest = regular.filter((k) => k !== latest).sort((a, b) => waited(b) - waited(a))[0];
  if (longest === undefined || longest === pick) return pick;
  const dueBy = expectedGapDays(pace.perWeek, regular.length);
  const clearly = waited(longest) - waited(pick) >= 7 / Math.max(1, pace.perWeek);
  return waited(longest) >= dueBy && clearly ? longest : pick;
}

/**
 * The next workout from the user's own rotation: the main lifts of the type's last workout stay,
 * and the remaining slots rotate through what they've done for that type recently. Same muscle
 * first, then whatever was done longest ago. Null with no history.
 */
export function planNextType(workouts: RotationWorkout[], exercises: Map<string, Exercise>, pace?: RotationPace): PlannedType | null {
  const usable = workouts.filter((w) => w.exerciseIds.some((id) => exercises.has(id))).slice(-WINDOW);
  if (!usable.length) return null;
  const keys = rotationKeys(usable, exercises);
  const key = pace ? overdueKey(keys, usable.map((w) => w.date), pace) : nextKey(keys);
  if (key === null) return null;

  const ofType = usable.filter((_, i) => keys[i] === key).slice(-TYPE_LOOKBACK);
  const latest = ofType[ofType.length - 1];
  const known = latest.exerciseIds.filter((id) => exercises.has(id));
  const sizes = ofType.map((w) => w.exerciseIds.length).sort((a, b) => a - b);
  const size = Math.min(MAX_EXERCISES, Math.max(MIN_EXERCISES, sizes[Math.floor(sizes.length / 2)]));

  const kept = known.slice(0, Math.min(ANCHORS, known.length));
  const lastUsed = new Map<string, string>();
  for (const workout of ofType) for (const id of workout.exerciseIds) lastUsed.set(id, workout.date);
  const pool = [...lastUsed.keys()]
    .filter((id) => exercises.has(id) && !kept.includes(id) && (!known.includes(id) || lastUsed.get(id) !== latest.date))
    .sort((a, b) => (lastUsed.get(a) ?? '').localeCompare(lastUsed.get(b) ?? ''));

  const chosen = [...kept];
  for (const id of known.slice(kept.length)) {
    if (chosen.length >= size) break;
    const muscle = exercises.get(id)?.muscle;
    const swap = pool.find((p) => !chosen.includes(p) && exercises.get(p)?.muscle === muscle);
    chosen.push(swap ?? id);
  }
  // A shorter last workout than usual: top up from the pool.
  for (const id of pool) {
    if (chosen.length >= size) break;
    if (!chosen.includes(id)) chosen.push(id);
  }
  return { key, exerciseIds: chosen };
}
