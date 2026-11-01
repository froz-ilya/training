import { groupOf, leadingGroup } from '../catalog/groups';
import { daysBetween } from '../dates';
import type { Exercise, Muscle } from '../types';
import { fitWeek, muscleBudgets, workedExercises } from './budget';
import { expectedGapDays } from './frequency';

/** A finished workout, newest last, as the rotation sees it. */
export interface RotationWorkout {
  id: string;
  date: string;
  exerciseIds: string[];
  /** Work sets per exercise. */
  workSets: Record<string, number>;
}

/** Why this type. `types` is what to show, in order: what was just done, then this one. */
export interface TypeReason {
  kind: 'usual' | 'before' | 'longest';
  types: string[];
}

/** Why this variant of the type. Ids are exercises; `after` is the lead of the workout the rotation stands at. */
export interface VariantReason {
  kind: 'alternate' | 'again' | 'afterOneOff';
  after: string;
  lead: string;
}

export interface PlannedType {
  key: string;
  exerciseIds: string[];
  /** Null with a single regular type, or when another type was picked. */
  typeReason: TypeReason | null;
  /** The rotation's other types, to switch to: the suggestion first, then the one left longest. */
  otherTypes: string[];
  /** Null with fewer than two regular variants, or when another variant was picked. */
  reason: VariantReason | null;
  /** The leads of the type's other variants, to switch to: the suggestion first. */
  otherLeads: string[];
  /** Fillers taken out because their muscle has had enough this week. */
  leftOut: string[];
  /** Muscles brought in because they're due this week. */
  added: Muscle[];
}

/** Another type or variant than the suggested one, for today only. Unknown ones are ignored. */
export interface NextPick {
  type?: string;
  lead?: string;
}

/** How far back the rotation looks. */
const WINDOW = 30;
const TYPE_LOOKBACK = 10;
const MIN_EXERCISES = 3;
const MAX_EXERCISES = 6;
const ANCHORS = 3;
/** How much of a workout has to match a variant for a lead seen once to be a small change to it. */
const SAME_SHARE = 2 / 3;
const MAX_OTHER_VARIANTS = 4;

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

/** Keys seen more than once. */
function repeated(keys: string[]): string[] {
  const seen = new Map<string, number>();
  for (const key of keys) if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([key]) => key);
}

/** How often each key came straight after `tail`. */
function countAfter(known: string[], tail: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = tail.length; i < known.length; i++) {
    if (tail.every((key, j) => known[i - tail.length + j] === key)) counts.set(known[i], (counts.get(known[i]) ?? 0) + 1);
  }
  return counts;
}

/** What followed the last two keys; if none of `candidates` ever did, what followed the last one. */
function following(known: string[], candidates: string[]): { tail: string[]; counts: Map<string, number> } {
  const pair = known.slice(-2);
  const counts = countAfter(known, pair);
  if (candidates.some((key) => counts.has(key))) return { tail: pair, counts };
  const tail = known.slice(-1);
  return { tail, counts: countAfter(known, tail) };
}

/** Of `candidates`, what has most often come after the latest keys; on a tie, the one left longest. */
function mostFollowing(known: string[], candidates: string[]): string {
  const { counts } = following(known, candidates);
  const lastSeen = (key: string) => known.lastIndexOf(key);
  return [...candidates].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || lastSeen(a) - lastSeen(b))[0];
}

/** The types that can come next: not the latest, and no one-offs while there are regular ones. */
function keyChoices(known: string[]): string[] {
  const others = [...new Set(known)].filter((k) => k !== known[known.length - 1]);
  // A type done once in this window was a one-off, not part of the rotation.
  const twice = repeated(known);
  const regular = others.filter((k) => twice.includes(k));
  return regular.length ? regular : others;
}

/** The type that usually follows the latest two; on a tie, the one left longest. */
export function nextKey(keys: string[]): string | null {
  const known = keys.filter(Boolean);
  if (!known.length) return null;
  const choices = keyChoices(known);
  return choices.length ? mostFollowing(known, choices) : known[known.length - 1];
}

/** The user's week, so the rotation can catch up with a type that has waited too long. */
export interface RotationPace {
  today: string;
  perWeek: number;
}

/** Types done more than once; one-offs aren't part of the rotation. */
function regularKeys(keys: string[]): string[] {
  const regular = repeated(keys);
  return regular.length ? regular : [...new Set(keys.filter(Boolean))];
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

/** Why the rotation suggests `key`, told only as far as the user's own history backs it up. */
function typeReason(keys: string[], key: string): TypeReason | null {
  if (regularKeys(keys).length < 2) return null;
  const known = keys.filter(Boolean);
  // True only if nothing, one-offs included, has waited longer.
  const longest = (): TypeReason | null => (known.some((k) => known.lastIndexOf(k) < known.lastIndexOf(key)) ? null : { kind: 'longest', types: [key] });
  // Anything but the usual choice was overdue.
  if (key !== nextKey(keys)) return longest();
  const choices = keyChoices(known);
  const { tail, counts } = following(known, choices);
  const count = counts.get(key) ?? 0;
  if (!count) return longest();
  const mostOften = choices.every((k) => k === key || (counts.get(k) ?? 0) < count);
  return { kind: count > 1 && mostOften ? 'usual' : 'before', types: [...tail, key] };
}

/** The exercise a workout is built around: the first worked one of its type, so a warm-up doesn't count. */
function leadOf(workout: RotationWorkout, key: string, exercises: Map<string, Exercise>): string {
  const main = workedExercises(workout, exercises);
  return main.find((id) => groupOf(exercises.get(id)!.muscle) === key) ?? main[0];
}

/** What the user does in this type, or after the main lifts in another: longest ago first. */
function borrowableExercises(workouts: RotationWorkout[], keys: string[], key: string, exercises: Map<string, Exercise>): string[] {
  const lastUsed = new Map<string, string>();
  workouts.forEach((workout, i) => {
    workedExercises(workout, exercises).forEach((id, at) => {
      if (keys[i] === key || at >= ANCHORS) lastUsed.set(id, workout.date);
    });
  });
  return [...lastUsed.keys()].sort((a, b) => (lastUsed.get(a) ?? '').localeCompare(lastUsed.get(b) ?? ''));
}

/**
 * Which variant of a type each workout was, named by its lead. A lead seen once that shares most of
 * its exercises with a regular variant is that variant with a small change: the bench was taken, say.
 * A lead that comes back stays its own variant even with the same exercises, because changing the
 * order on purpose is a plan, and following it does no harm when it isn't.
 */
export function variantLeads(workouts: RotationWorkout[], key: string, exercises: Map<string, Exercise>): string[] {
  const leads = workouts.map((workout) => leadOf(workout, key, exercises));
  const regular = repeated(leads);
  const doneIn = regular.map((lead) => ({ lead, ids: new Set(workouts.flatMap((w, i) => (leads[i] === lead ? w.exerciseIds : []))) }));
  return leads.map((lead, i) => {
    if (regular.includes(lead)) return lead;
    const known = workouts[i].exerciseIds.filter((id) => exercises.has(id));
    const shareOf = (ids: Set<string>) => known.filter((id) => ids.has(id)).length / known.length;
    const closest = doneIn.filter((v) => shareOf(v.ids) >= SAME_SHARE).sort((a, b) => shareOf(b.ids) - shareOf(a.ids))[0];
    return closest?.lead ?? lead;
  });
}

/**
 * The variant that usually follows the latest regular one; on a tie, the one left longest. One-offs
 * are left out of the order. Unlike a type, a variant may follow itself: someone who mostly repeats
 * one variant shouldn't be sent to the other every time. Null until a variant repeats.
 */
export function nextVariant(leads: string[]): string | null {
  const regular = repeated(leads);
  const known = leads.filter((lead) => regular.includes(lead));
  if (!known.length) return null;
  return mostFollowing(known, regular);
}

function variantReason(workouts: RotationWorkout[], leads: string[], lead: string, key: string, exercises: Map<string, Exercise>): VariantReason | null {
  const regular = repeated(leads);
  if (regular.length < 2) return null;
  let at = leads.length - 1;
  while (!regular.includes(leads[at])) at--;
  // A small change counts as its variant, but the reason says what that workout really had.
  const after = leadOf(workouts[at], key, exercises);
  if (lead === leads[at]) return { kind: 'again', after, lead };
  return { kind: at === leads.length - 1 ? 'alternate' : 'afterOneOff', after, lead };
}

/**
 * The next workout from the user's own rotation: the type's next variant, with the main lifts of
 * that variant's last workout kept and the remaining slots rotating through what they've done for it
 * recently. Same muscle first, then whatever was done longest ago. Those slots then fit the user's
 * week, which needs `pace` for today's date. `pick` swaps the suggested type or variant for another,
 * and everything else then works the same. Null with no history.
 */
export function planNextType(workouts: RotationWorkout[], exercises: Map<string, Exercise>, pace?: RotationPace, pick: NextPick = {}): PlannedType | null {
  const usable = workouts.filter((w) => w.exerciseIds.some((id) => exercises.has(id))).slice(-WINDOW);
  if (!usable.length) return null;
  const keys = rotationKeys(usable, exercises);
  const suggestedKey = pace ? overdueKey(keys, usable.map((w) => w.date), pace) : nextKey(keys);
  if (suggestedKey === null) return null;
  const key = pick.type && keys.includes(pick.type) ? pick.type : suggestedKey;

  const ofType = usable.filter((_, i) => keys[i] === key).slice(-TYPE_LOOKBACK);
  const leads = variantLeads(ofType, key, exercises);
  const suggested = nextVariant(leads) ?? leads[leads.length - 1];
  const variant = pick.lead && leads.includes(pick.lead) ? pick.lead : suggested;

  const scope = ofType.filter((_, i) => leads[i] === variant);
  // A small change can swap the lead for a day, so the plan comes from a workout with the real one.
  const own = scope.filter((w) => leadOf(w, key, exercises) === variant);
  const latest = own[own.length - 1];
  const known = latest.exerciseIds.filter((id) => exercises.has(id));
  const sizes = scope.map((w) => w.exerciseIds.length).sort((a, b) => a - b);
  const size = Math.min(MAX_EXERCISES, Math.max(MIN_EXERCISES, sizes[Math.floor(sizes.length / 2)]));

  const kept = known.slice(0, Math.min(ANCHORS, known.length));
  const lastUsed = new Map<string, string>();
  for (const workout of scope) for (const id of workout.exerciseIds) lastUsed.set(id, workout.date);
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

  const fit = fitWeek(
    {
      exerciseIds: chosen,
      anchors: [...new Set([...kept, variant])],
      type: key,
      size,
      min: MIN_EXERCISES,
      pool,
      borrowable: borrowableExercises(usable, keys, key, exercises),
    },
    pace ? muscleBudgets(workouts, exercises, pace.today) : new Map(),
    exercises,
  );

  const regular = repeated(leads);
  const newestFirst = [...leads].reverse();
  const otherLeads = [...new Set([suggested, ...newestFirst.filter((l) => regular.includes(l)), ...newestFirst])]
    .filter((l) => l !== variant)
    .slice(0, MAX_OTHER_VARIANTS);
  const leftLongest = regularKeys(keys).sort((a, b) => keys.lastIndexOf(a) - keys.lastIndexOf(b));
  return {
    key,
    exerciseIds: fit.exerciseIds,
    leftOut: fit.leftOut,
    added: fit.added,
    typeReason: key === suggestedKey ? typeReason(keys, key) : null,
    otherTypes: [...new Set([suggestedKey, ...leftLongest])].filter((k) => k !== key),
    reason: variant === suggested ? variantReason(ofType, leads, variant, key, exercises) : null,
    otherLeads,
  };
}
