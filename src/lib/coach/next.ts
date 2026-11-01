import { groupOf, leadingGroup, type MuscleGroup } from '../catalog/groups';
import { daysBetween } from '../dates';
import type { BodyRegion, Exercise, Muscle, RegionGoal } from '../types';
import { fitWeek, muscleBudgets, workedExercises } from './budget';
import { HELPER_WEIGHT } from './fatigue';
import { applyFocus, heldEnough, trainsShortFocus, weekSets } from './focus';
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

/** An exercise brought in because a Focus muscle is short this week. */
export interface FocusPick {
  exerciseId: string;
  region: BodyRegion;
  /** Not in the user's history yet, so it came from the catalogue. */
  fresh: boolean;
  /** The filler it took the place of; none when it went on top. */
  replaced?: string;
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
  focus: FocusPick[];
  /** The muscles usually trained with each type, which are part of what it's called. */
  partners: Record<string, Muscle[]>;
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

/** The groups a rotation type can be. Shoulders, arms and core round a day off rather than define it. */
const ROTATION_GROUPS: readonly MuscleGroup[] = ['chest', 'back', 'legs'];
/** The share of a day's chest, back and legs work that makes it count as that group's workout. */
const TYPE_SHARE = 1 / 3;
/** Between the groups of a type that a habit has joined. */
const TYPE_JOIN = '+';
/** How far back a habit is read, so an old split fades. */
const HABIT_LOOKBACK = 12;
const HABIT_MIN_DAYS = 2;
/** More than this share of the days makes a habit: half is still a coin toss. */
const HABIT_SHARE = 1 / 2;

const isHabit = (days: number, ofDays: number) => days >= HABIT_MIN_DAYS && days / ofDays > HABIT_SHARE;

/** The groups of a rotation type. */
export function typeGroups(key: string): MuscleGroup[] {
  return key.split(TYPE_JOIN) as MuscleGroup[];
}

function exerciseGroup(id: string, exercises: Map<string, Exercise>): MuscleGroup | undefined {
  const muscle = exercises.get(id)?.muscle;
  return muscle && groupOf(muscle);
}

/**
 * The groups a workout trained, in the order they first appear in it. Helpers count, so a deadlift
 * also trains legs. With none of chest, back and legs: the group it trained most.
 */
function workoutGroups(workout: RotationWorkout, exercises: Map<string, Exercise>): MuscleGroup[] {
  const done = workout.exerciseIds.flatMap((id) => {
    const exercise = exercises.get(id);
    return exercise ? [{ exercise, sets: Math.max(1, workout.workSets[id] ?? 0) }] : [];
  });
  const totals = new Map<MuscleGroup, number>();
  const add = (muscle: Muscle, sets: number) => {
    const group = groupOf(muscle);
    if (ROTATION_GROUPS.includes(group)) totals.set(group, (totals.get(group) ?? 0) + sets);
  };
  for (const { exercise, sets } of done) {
    add(exercise.muscle, sets);
    for (const helper of exercise.helpers ?? []) add(helper, sets * HELPER_WEIGHT);
  }
  const all = [...totals.values()].reduce((sum, sets) => sum + sets, 0);
  // Help alone doesn't make a type: dips on an arms day aren't a chest day.
  if (done.some(({ exercise }) => ROTATION_GROUPS.includes(groupOf(exercise.muscle)))) {
    return [...totals].filter(([, sets]) => sets / all >= TYPE_SHARE).map(([group]) => group);
  }
  const leading = leadingGroup(done.map(({ exercise, sets }) => ({ muscle: exercise.muscle, sets })));
  return leading ? [leading] : [];
}

/**
 * The types each workout counts as. Short of time, people combine two workouts rather than skip one,
 * so a combined day is both of them and not a third type. But groups trained together on most of the
 * days either is trained are one type, because that's how this person splits their week. Only a
 * group's own exercises show that: a deadlift doesn't pair back with legs.
 */
function dayTypes(workouts: RotationWorkout[], exercises: Map<string, Exercise>): string[][] {
  const days = workouts.map((workout) => workoutGroups(workout, exercises));
  const recent = days
    .map((groups, i) => groups.filter((group) => workouts[i].exerciseIds.some((id) => exerciseGroup(id, exercises) === group)))
    .slice(-HABIT_LOOKBACK);
  const together = (a: MuscleGroup, b: MuscleGroup) =>
    isHabit(recent.filter((day) => day.includes(a) && day.includes(b)).length, recent.filter((day) => day.includes(a) || day.includes(b)).length);
  return days.map((groups) => {
    const parts: MuscleGroup[][] = [];
    for (const group of groups) {
      const part = parts.find((joined) => joined.some((other) => together(other, group)));
      if (part) part.push(group);
      else parts.push([group]);
    }
    return parts.map((part) => part.sort((a, b) => ROTATION_GROUPS.indexOf(a) - ROTATION_GROUPS.indexOf(b)).join(TYPE_JOIN));
  });
}

/**
 * The history as the rotation reads it: a combined day is its types in turn, each with that day's
 * date. Half of a joined type on its own is left out: the rotation goes by the split as it is now.
 */
function rotationOrder(workouts: RotationWorkout[], types: string[][]): { keys: string[]; dates: string[] } {
  const joined = [...new Set(types.flat())].filter((key) => key.includes(TYPE_JOIN)).flatMap(typeGroups);
  const keys: string[] = [];
  const dates: string[] = [];
  workouts.forEach((workout, i) => {
    for (const key of types[i].length ? types[i] : ['']) {
      if (joined.includes(key as MuscleGroup)) continue;
      keys.push(key);
      dates.push(workout.date);
    }
  });
  return { keys, dates };
}

/** The rotation's keys: one per type a workout counts as, or '' with no known exercises. */
export function rotationKeys(workouts: RotationWorkout[], exercises: Map<string, Exercise>): string[] {
  return rotationOrder(workouts, dayTypes(workouts, exercises)).keys;
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
  return main.find((id) => typeGroups(key).includes(groupOf(exercises.get(id)!.muscle))) ?? main[0];
}

/** A workout as a plan for `key` reads it. */
interface TypeWorkout extends RotationWorkout {
  /** It counted for another type too. */
  combined: boolean;
}

/**
 * A type's recent workouts. A combined day gives only this type's part: the other type's exercises
 * go and fillers stay. If nothing of this type's own is there, as when legs came only from a
 * deadlift, the whole day stands, because that's what trained it.
 */
function workoutsOfType(workouts: RotationWorkout[], types: string[][], key: string, exercises: Map<string, Exercise>): TypeWorkout[] {
  const own = typeGroups(key);
  return workouts.flatMap((workout, i) => {
    if (!types[i].includes(key)) return [];
    const others = types[i].filter((type) => type !== key).flatMap(typeGroups);
    const inGroups = (id: string, groups: MuscleGroup[]) => groups.some((group) => group === exerciseGroup(id, exercises));
    const hasOwn = workout.exerciseIds.some((id) => inGroups(id, own));
    const exerciseIds = hasOwn ? workout.exerciseIds.filter((id) => !inGroups(id, others)) : workout.exerciseIds;
    return [{ ...workout, exerciseIds, combined: others.length > 0 }];
  });
}

/**
 * The muscles outside a type's own groups that most of its recent days trained, most often first:
 * shoulders with legs, say. They're part of that day, not fillers. Cardio is too often a warm-up
 * to say what a day is.
 */
function partnerMuscles(days: RotationWorkout[], key: string, exercises: Map<string, Exercise>): Muscle[] {
  const recent = days.slice(-TYPE_LOOKBACK);
  const counts = new Map<Muscle, number>();
  for (const day of recent) {
    for (const muscle of new Set(workedExercises(day, exercises).map((id) => exercises.get(id)!.muscle))) {
      if (muscle !== 'cardio' && !typeGroups(key).includes(groupOf(muscle))) counts.set(muscle, (counts.get(muscle) ?? 0) + 1);
    }
  }
  return [...counts].filter(([, n]) => isHabit(n, recent.length)).sort((a, b) => b[1] - a[1]).map(([muscle]) => muscle);
}

/** What the user does in this type, or after the main lifts in another: longest ago first. */
function borrowableExercises(workouts: RotationWorkout[], types: string[][], key: string, exercises: Map<string, Exercise>): string[] {
  const lastUsed = new Map<string, string>();
  workouts.forEach((workout, i) => {
    workedExercises(workout, exercises).forEach((id, at) => {
      if (types[i].includes(key) || at >= ANCHORS) lastUsed.set(id, workout.date);
    });
  });
  return [...lastUsed.keys()].sort((a, b) => (lastUsed.get(a) ?? '').localeCompare(lastUsed.get(b) ?? ''));
}

/** What these workouts really worked: longest ago first. */
function doneExercises(workouts: RotationWorkout[], exercises: Map<string, Exercise>): string[] {
  const lastUsed = new Map<string, string>();
  for (const workout of workouts) {
    for (const id of workedExercises(workout, exercises)) lastUsed.set(id, workout.date);
  }
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
 * week, which needs `pace` for today's date, and so do `goals`: see focus.ts. `pick` swaps the
 * suggested type or variant for another, and everything else then works the same. Null with no history.
 */
export function planNextType(
  workouts: RotationWorkout[],
  exercises: Map<string, Exercise>,
  pace?: RotationPace,
  pick: NextPick = {},
  goals: Partial<Record<BodyRegion, RegionGoal>> = {},
): PlannedType | null {
  const usable = workouts.filter((w) => w.exerciseIds.some((id) => exercises.has(id))).slice(-WINDOW);
  if (!usable.length) return null;
  const types = dayTypes(usable, exercises);
  const { keys, dates } = rotationOrder(usable, types);
  const suggestedKey = pace ? overdueKey(keys, dates, pace) : nextKey(keys);
  if (suggestedKey === null) return null;
  const key = pick.type && keys.includes(pick.type) ? pick.type : suggestedKey;

  const ofType = workoutsOfType(usable, types, key, exercises).slice(-TYPE_LOOKBACK);
  const leads = variantLeads(ofType, key, exercises);
  const suggested = nextVariant(leads) ?? leads[leads.length - 1];
  const variant = pick.lead && leads.includes(pick.lead) ? pick.lead : suggested;

  const scope = ofType.filter((_, i) => leads[i] === variant);
  // A small change can swap the lead for a day, so the plan comes from a workout with the real one.
  const own = scope.filter((w) => leadOf(w, key, exercises) === variant);
  // A combined day was cut short, so a full workout of the type makes the better base.
  const full = own.filter((w) => !w.combined);
  const latest = full.length ? full[full.length - 1] : own[own.length - 1];
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

  const partners: Record<string, Muscle[]> = {};
  for (const type of new Set(keys.filter(Boolean))) partners[type] = partnerMuscles(workoutsOfType(usable, types, type, exercises), type, exercises);
  const dayPartners = partners[key] ?? [];

  // A day that skipped a partner shouldn't teach the plan to skip it too. This goes by the variant:
  // one that never has the partner is meant that way.
  const muscleOf = (id: string) => exercises.get(id)?.muscle;
  const usedInVariant = [...scope].reverse().flatMap((w) => w.exerciseIds);
  for (const muscle of partnerMuscles(scope, key, exercises)) {
    const id = usedInVariant.find((candidate) => muscleOf(candidate) === muscle);
    if (id === undefined || chosen.some((c) => muscleOf(c) === muscle)) continue;
    const fillers = chosen.flatMap((c, at) => (kept.includes(c) || dayPartners.includes(muscleOf(c)!) ? [] : [at]));
    if (chosen.length >= size && fillers.length) chosen[fillers[fillers.length - 1]] = id;
    else if (chosen.length < MAX_EXERCISES) chosen.push(id);
  }

  const onOwnDays = new Set(ofType.map((w) => w.id));
  const anchors = [...new Set([...kept, variant])];
  const active = pace ? goals : {};
  const week = pace ? weekSets(workouts, exercises, pace.today) : new Map<BodyRegion, number>();
  const fit = fitWeek(
    {
      exerciseIds: chosen,
      anchors,
      groups: typeGroups(key),
      partners: dayPartners,
      elsewhere: Object.entries(partners).flatMap(([type, muscles]) => (type === key ? [] : muscles)),
      size,
      min: MIN_EXERCISES,
      pool,
      borrowable: borrowableExercises(usable, types, key, exercises),
      enough: (id) => heldEnough(exercises.get(id)!, active, week),
      needed: (id) => trainsShortFocus(exercises.get(id)!, active, week),
    },
    pace ? muscleBudgets(workouts, exercises, pace.today, (workout, muscle) => onOwnDays.has(workout.id) && dayPartners.includes(muscle)) : new Map(),
    exercises,
  );
  const recent = doneExercises(usable, exercises);
  const focus = applyFocus(
    {
      exerciseIds: fit.exerciseIds,
      anchors,
      groups: typeGroups(key),
      partners: dayPartners,
      leftOut: fit.leftOut,
      max: MAX_EXERCISES,
      recent,
      older: doneExercises(workouts, exercises).filter((id) => !recent.includes(id)),
    },
    active,
    week,
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
    exerciseIds: focus.exerciseIds,
    leftOut: fit.leftOut,
    // A focus can take the slot of what was added, and then it isn't there to report.
    added: fit.added.filter((muscle) => focus.exerciseIds.some((id) => exercises.get(id)?.muscle === muscle)),
    focus: focus.picks,
    partners,
    typeReason: key === suggestedKey ? typeReason(keys, key) : null,
    otherTypes: [...new Set([suggestedKey, ...leftLongest])].filter((k) => k !== key),
    reason: variant === suggested ? variantReason(ofType, leads, variant, key, exercises) : null,
    otherLeads,
  };
}
