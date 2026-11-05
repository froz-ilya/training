import { difficultyOf, difficultyPoints } from '../catalog/difficulty';
import { dayWork, groupOf, type MuscleGroup } from '../catalog/groups';
import { BODY_REGIONS, regionsOf } from '../catalog/regions';
import { daysBetween } from '../dates';
import type { BodyRegion, Exercise, Muscle, RegionGoal } from '../types';
import { regionRange } from './balance';
import { SMALL } from './budget';
import { HELPER_WEIGHT } from './fatigue';
import type { FocusExtra, FocusPick, RotationWorkout } from './next';
import { median } from './position';
import type { SometimesPick } from './sometimes';

/**
 * The user's goals for parts of the body, as the planner follows them. A Focus muscle that's short
 * this week gets more work, and a Maintain muscle that has had enough gives up its fillers. Exercises
 * marked Sometimes come in here too, since they take a place in the plan the same way. It only changes
 * which exercises are planned and where they go, never their weights, and with no goals and nothing
 * due it changes nothing.
 */

export type RegionGoals = Partial<Record<BodyRegion, RegionGoal>>;
/** Work sets per region in a week, counted as the body map counts them. */
export type RegionSets = Map<BodyRegion, number>;

const DAYS_IN_WEEK = 7;
/** What an exercise in the plan is taken to add, before its sets are suggested. */
export const PLANNED_SETS = 3;
/** A workout stays the user's own: the accent is a part of it. */
const MAX_FOCUS = 2;
/** A starting value: a Focus exercise may make a workout a little harder than usual, not a lot. */
const ROOM = 1;
/** A starting value: sets added to exercises already planned, a few minutes' work in all. */
const MAX_EXTRA_SETS = 4;
/** Muscles that round off any day. Chest, back and legs wait for their own. */
const ANY_DAY: readonly Muscle[] = ['shoulders', ...SMALL];
/** The muscle each region is part of, as the catalogue files its exercises. */
const MUSCLE_OF: Record<BodyRegion, Muscle> = {
  chest: 'chest',
  frontDelts: 'shoulders',
  sideDelts: 'shoulders',
  rearDelts: 'shoulders',
  upperBack: 'back',
  lats: 'back',
  lowerBack: 'back',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms',
  abs: 'abs',
  glutes: 'glutes',
  quads: 'legs',
  hamstrings: 'legs',
  calves: 'calves',
};
/**
 * A region of chest, back or legs, which a day's type is built around: chest, upper back, lats, lower
 * back, glutes, quads and hamstrings. The rest can join any day: the delts, arms, abs and calves.
 */
const isBig = (region: BodyRegion) => !ANY_DAY.includes(MUSCLE_OF[region]);

/**
 * A set more on this exercise uses Focus's share of the week. One on an exercise mainly for small
 * muscles alone is free: a set more for them is only a few minutes, and they wait for no day. Which
 * region a stored set more was for isn't stored, so an exercise mainly for a big Focus muscle too, a
 * dip for chest and triceps say, always counts, the way it would when it was added for the big one.
 */
export function extraCounts(exercise: Exercise, goals: RegionGoals): boolean {
  return regionsOf(exercise).main.some((region) => isBig(region) && goals[region] === 'focus');
}
/** Days a muscle rests after its main work before light work on another day. */
const REST_DAYS = 2;
/**
 * A starting value: the share of a usual week's work sets that Focus may add over 7 days, so even many
 * Focus muscles don't make the week much bigger than the user is used to.
 */
const FOCUS_SHARE = 0.2;
/** A starting value: the least Focus may add over 7 days, an exercise and a set, so a small week still gets some. */
const MIN_FOCUS_SETS = 4;
/** A starting value for a usual week with too little history to go by: three workouts of four or five exercises. */
const DEFAULT_WEEK_SETS = 40;
/** The last weeks with workouts that set the usual week. */
const USUAL_WEEKS = 4;
/** With fewer of those weeks, there's no usual week to go by. */
const MIN_USUAL_WEEKS = 2;
/** A starting value: how much longer than usual a workout with Focus additions may get. */
const EXTRA_MINUTES = 15;
/** A starting value for a work set with its rest, when no workout says how long the user takes. */
const DEFAULT_MINUTES_PER_SET = 3;
/** Longer than this, the workout was most likely left open, as workoutMinutes() reads it. */
const LEFT_OPEN_MINUTES = 5 * 60;
/** Recent timed workouts that set the minutes a work set takes. */
const TIMED_WORKOUTS = 30;
/** Workouts of the type that set its usual length. */
const TYPE_WORKOUTS = 10;
/** More Focus muscles than this share out the extra work, so each gets it less often. */
export const MANY_FOCUS = 3;

const setsOf = (week: RegionSets, region: BodyRegion) => week.get(region) ?? 0;

/** The last 7 days, from the same place the rotation reads them. */
export function weekSets(workouts: RotationWorkout[], exercises: Map<string, Exercise>, today: string): RegionSets {
  const week: RegionSets = new Map();
  const add = (region: BodyRegion, sets: number) => week.set(region, setsOf(week, region) + sets);
  for (const { date, workSets } of workouts) {
    const daysAgo = daysBetween(date, today);
    if (daysAgo < 0 || daysAgo >= DAYS_IN_WEEK) continue;
    for (const [id, sets] of Object.entries(workSets)) {
      const exercise = exercises.get(id);
      if (!exercise) continue;
      const { main, helpers } = regionsOf(exercise);
      for (const region of main) add(region, sets);
      for (const region of helpers) add(region, sets * HELPER_WEIGHT);
    }
  }
  return week;
}

/** The date each region last had work sets on an exercise mainly for it. */
export function lastMainWork(workouts: RotationWorkout[], exercises: Map<string, Exercise>): Map<BodyRegion, string> {
  const last = new Map<BodyRegion, string>();
  for (const { date, workSets } of workouts) {
    for (const [id, sets] of Object.entries(workSets)) {
      const exercise = exercises.get(id);
      if (!exercise || !(sets > 0)) continue;
      for (const region of regionsOf(exercise).main) if ((last.get(region) ?? '') < date) last.set(region, date);
    }
  }
  return last;
}

/** Everything it's mainly for is on Maintain, and each of those has had enough this week. */
export function heldEnough(exercise: Exercise, goals: RegionGoals, week: RegionSets): boolean {
  const { main } = regionsOf(exercise);
  return main.length > 0 && main.every((region) => goals[region] === 'maintain' && setsOf(week, region) >= regionRange(region, 'maintain').low);
}

/** It's mainly for a Focus muscle that hasn't reached its range this week. */
export function trainsShortFocus(exercise: Exercise, goals: RegionGoals, week: RegionSets): boolean {
  return regionsOf(exercise).main.some((region) => goals[region] === 'focus' && setsOf(week, region) < regionRange(region, 'focus').low);
}

/** What Focus has given lately, and what it may give. */
export interface FocusWeek {
  /** Work sets Focus may add over 7 days. */
  budget: number;
  /** What it gave each Focus muscle over the last 7 days. Today's plan isn't in it. */
  given: Map<BodyRegion, number>;
  /** What it gave each of them in the 7 days before that, so the one that waited longest goes first. */
  earlier: Map<BodyRegion, number>;
  /**
   * What it gave them all over the last 7 days, by days ago, 0 being today: so what will still count on
   * a later day is known. Without it, all of `given` is taken to count still.
   */
  byDaysAgo?: number[];
}

/**
 * Weeks before a counted week that say what a type already had. Long enough for the plan's own
 * rotation of fillers to come round, so a filler coming back isn't taken for Focus's work.
 */
const USUAL_FOR_TYPE_WEEKS = 8;
/** Done in fewer than this share of a type's workouts, an exercise isn't settled in the type yet. */
const UNSETTLED_SHARE = 1 / 2;
/** The days of history focusWeek reads exercises from: the two weeks it counts and the weeks before them. */
export const FOCUS_HISTORY_DAYS = (2 + USUAL_FOR_TYPE_WEEKS) * DAYS_IN_WEEK;

/**
 * Focus's share of the week, read from history alone, and only from what Focus can be shown to have
 * added. Plain work never counts, however often a type is trained, and neither does today's plan.
 *  - Sets Focus added to planned exercises are stored as `extra`, so they count as they are, for the
 *    big muscles the exercise is mainly for. One on an exercise for small muscles alone is free (see extraCounts).
 *  - Light work for chest, back or legs on another of them's day (dayWork()) always counts: that's
 *    what Focus brings in on another day.
 *  - An exercise Focus brought in is stored as any other, so its sets count while it's new to its
 *    workout's type: none of that type's workouts in the USUAL_FOR_TYPE_WEEKS before the counted week
 *    had it. Once it's been done there more than 7 days ago it's part of the type.
 *  - The plan keeps the type's usual number of exercises, so a pick it doesn't keep yet comes back on
 *    top each time. A workout past that number counts what's over it, taking the exercises the type
 *    has had least, while they're in fewer than half of the type's workouts in those weeks. A combined
 *    day is longer anyway, so it doesn't count this way.
 * With no workout of the type in those weeks there's nothing to go by, so only the first two count.
 * `typesOf` gives a workout's rotation types (see workoutTypes() in next.ts).
 *
 * The share is a fifth of the usual week: the median of the last weeks with workouts, counted back
 * from today as the rotation counts them, with the last 7 days left out. With too little history,
 * DEFAULT_WEEK_SETS.
 */
export function focusWeek(
  workouts: RotationWorkout[],
  exercises: Map<string, Exercise>,
  goals: RegionGoals,
  today: string,
  typesOf: (workout: RotationWorkout) => readonly string[],
): FocusWeek {
  const totals = new Map<number, number>();
  for (const workout of workouts) {
    const daysAgo = daysBetween(workout.date, today);
    if (daysAgo < 0) continue;
    const index = Math.floor(daysAgo / DAYS_IN_WEEK);
    for (const [id, sets] of Object.entries(workout.workSets)) {
      if (!exercises.has(id)) continue;
      totals.set(index, (totals.get(index) ?? 0) + sets - Math.min(sets, workout.extra?.[id] ?? 0));
    }
  }
  const trained = [...totals.keys()].filter((index) => index > 0 && totals.get(index)! > 0).sort((a, b) => a - b).slice(0, USUAL_WEEKS);
  const usualWeek = trained.length >= MIN_USUAL_WEEKS ? median(trained.map((index) => totals.get(index)!)) : DEFAULT_WEEK_SETS;

  const within = (workout: RotationWorkout, from: number, days: number) => {
    const daysAgo = daysBetween(workout.date, today);
    return daysAgo >= from && daysAgo < from + days;
  };
  /** The exercises a workout worked: those that say what the day was, and light work for another's day. */
  const parts = (workout: RotationWorkout) => {
    const ids = workout.exerciseIds.filter((id) => exercises.has(id) && workout.workSets[id] > 0);
    const day = new Set(dayWork(ids.map((id) => ({ id, exercise: exercises.get(id)! }))).map((work) => work.id));
    return { own: ids.filter((id) => day.has(id)), otherDay: ids.filter((id) => !day.has(id)) };
  };
  /** What Focus gave each region in the week `index` weeks back, and what it gave Focus muscles each day of it. */
  const gaveIn = (index: number) => {
    const gave = new Map<BodyRegion, number>();
    const byDay: number[] = Array.from({ length: DAYS_IN_WEEK }, () => 0);
    let day = 0;
    const give = (id: string, sets: number, only: (region: BodyRegion) => boolean = () => true) => {
      if (!(sets > 0)) return;
      for (const region of regionsOf(exercises.get(id)!).main.filter(only)) {
        gave.set(region, (gave.get(region) ?? 0) + sets);
        if (goals[region] === 'focus') byDay[day] += sets;
      }
    };
    const from = index * DAYS_IN_WEEK;
    const before = workouts.filter((workout) => within(workout, from + DAYS_IN_WEEK, USUAL_FOR_TYPE_WEEKS * DAYS_IN_WEEK));
    for (const workout of workouts.filter((w) => within(w, from, DAYS_IN_WEEK))) {
      day = daysBetween(workout.date, today) - from;
      const added = (id: string) => Math.min(workout.workSets[id], workout.extra?.[id] ?? 0);
      const usual = (id: string) => workout.workSets[id] - added(id);
      const { own, otherDay } = parts(workout);
      // Sets more count for the big muscles only, so a free one for a small muscle never reads as a big one's.
      for (const id of [...own, ...otherDay]) if (extraCounts(exercises.get(id)!, goals)) give(id, added(id), isBig);
      for (const id of otherDay) give(id, usual(id));
      const types = typesOf(workout);
      const sameType = before.filter((other) => typesOf(other).some((type) => types.includes(type)));
      // With nothing of the type to go by, nothing is new.
      if (!sameType.length) continue;
      const shareOf = (id: string) => sameType.filter((other) => other.workSets[id] > 0).length / sameType.length;
      const fresh = own.filter((id) => shareOf(id) === 0);
      for (const id of fresh) give(id, usual(id));
      // An exercise the plan doesn't keep yet comes back on top, past the type's usual number of exercises.
      const single = sameType.filter((other) => typesOf(other).length === 1);
      if (types.length !== 1 || !single.length) continue;
      const usualSize = Math.ceil(median(single.map((other) => parts(other).own.length)));
      const over = own.length - usualSize - fresh.length;
      if (over <= 0) continue;
      own
        .filter((id) => !fresh.includes(id) && shareOf(id) < UNSETTLED_SHARE)
        .sort((a, b) => shareOf(a) - shareOf(b) || own.indexOf(b) - own.indexOf(a))
        .slice(0, over)
        .forEach((id) => give(id, usual(id)));
    }
    return { gave, byDay };
  };
  const focus = BODY_REGIONS.filter((region) => goals[region] === 'focus');
  const [thisWeek, weekBefore] = [gaveIn(0), gaveIn(1)];
  return {
    budget: Math.max(MIN_FOCUS_SETS, Math.round(FOCUS_SHARE * usualWeek)),
    given: new Map(focus.map((region) => [region, thisWeek.gave.get(region) ?? 0])),
    earlier: new Map(focus.map((region) => [region, weekBefore.gave.get(region) ?? 0])),
    byDaysAgo: thisWeek.byDay,
  };
}

/** What's left of Focus's share of the week. */
function focusRoom({ budget, given }: FocusWeek): number {
  return Math.max(0, budget - [...given.values()].reduce((sum, sets) => sum + sets, 0));
}

/**
 * The most work sets a workout of this type may come to with Focus additions: its usual length and
 * EXTRA_MINUTES more, at the minutes a work set takes this user, rest included. Both are medians of
 * the user's own timed workouts, leaving out any left open. Unknown with no timed workout of the type,
 * and then there's no limit.
 */
export function maxWorkoutSets(recent: RotationWorkout[], ofType: RotationWorkout[]): number | undefined {
  const timed = (workout: RotationWorkout) => workout.minutes !== undefined && workout.minutes > 0 && workout.minutes <= LEFT_OPEN_MINUTES;
  const typeMinutes = ofType.filter(timed).slice(-TYPE_WORKOUTS).map((workout) => workout.minutes!);
  if (!typeMinutes.length) return undefined;
  const perSet = recent
    .filter(timed)
    .slice(-TIMED_WORKOUTS)
    .flatMap((workout) => {
      const sets = Object.values(workout.workSets).reduce((sum, n) => sum + n, 0);
      return sets > 0 ? [workout.minutes! / sets] : [];
    });
  const minutes = perSet.length ? median(perSet) : DEFAULT_MINUTES_PER_SET;
  return Math.floor((median(typeMinutes) + EXTRA_MINUTES) / minutes);
}

export interface FocusPlan {
  /** The plan once it fits the week. */
  exerciseIds: string[];
  /** Main lifts: never replaced. */
  anchors: string[];
  /** The type's groups. */
  groups: MuscleGroup[];
  /** Muscles this type's days usually train too: they stay, and they can join. */
  partners: Muscle[];
  /** Taken out to fit the week, so they don't come back. */
  leftOut: string[];
  /** The most exercises a workout has. */
  max: number;
  /** What the user has done lately, longest ago first. */
  recent: string[];
  /** What they did before that, longest ago first. */
  older: string[];
  /** What this kind of workout usually costs, in difficulty points. */
  usualPoints: number;
  /** Exercises that aren't to be picked: the ones the user doesn't want suggested, and any resting. */
  avoid?: ReadonlySet<string>;
  /** Exercises marked Sometimes that are due, longest waiting first. */
  due?: string[];
  /** When each marked exercise was last done. */
  lastDone?: ReadonlyMap<string, string>;
  /** The exercise's muscle has had enough this week. */
  full?: (id: string) => boolean;
  /** Today's date. Without it, nothing comes in for a muscle on another day than its own. */
  today?: string;
  /** When each region last had main work: see lastMainWork. */
  lastMain?: ReadonlyMap<BodyRegion, string>;
  /** The groups of the type the rotation expects after this one. Unknown, only the rest days count. */
  nextGroups?: MuscleGroup[];
  /** The partner muscles of that type. */
  nextPartners?: Muscle[];
  /**
   * The types the rotation expects over the rest of the user's usual week, in order, the next first,
   * with the days until each. Without it, nothing is kept for a muscle's own day.
   */
  upcoming?: { groups: MuscleGroup[]; partners: Muscle[]; days: number }[];
  /** Work sets an exercise is planned with. Without it, PLANNED_SETS. */
  setsOf?: (id: string) => number;
  /** Focus's share of the week, and what it has given: see focusWeek. Without it, no limit and no turns. */
  week?: FocusWeek;
  /** The most work sets the workout may come to with Focus additions. Without it, no limit. */
  maxSets?: number;
}

/**
 * What kept Focus from adding more today: its share of the week was used, the rest was kept for a
 * muscle whose turn it is, or for a muscle's own day later in the week, or the workout would have gone
 * past its usual length.
 */
export type FocusHeld = 'week' | 'turn' | 'ownDay' | 'time';

export interface FocusFit {
  exerciseIds: string[];
  picks: FocusPick[];
  /** Sets added to exercises already in the plan, at most one each. */
  extra: FocusExtra[];
  /** One a workout, so the workout stays the user's own. */
  sometimes?: SometimesPick;
  /** Set only when a limit really kept out something Focus would have added. */
  held?: FocusHeld;
}

/**
 * First, the first Sometimes exercise that's due and can join this day takes the place of a filler for
 * its muscle. With none, it waits if its muscle has had enough this week, or else goes on top if that
 * fits, or takes another filler's place. Those places have no limit on difficulty. A Focus pick comes
 * back every week, but this comes round every three, and a limit would keep out exactly the hard
 * exercises the mark is for.
 *
 * Then it brings in work for the Focus muscles that are short this week, in order (see below), one
 * exercise for each. What the user has done comes first, and only then something new. It can't take
 * the workout more than ROOM over its usual cost, or the next one is tried, and with none left the
 * muscle goes without today. An exercise that also trains what a filler trains takes that filler's place.
 * Otherwise the first goes on top if the workout has room and that fits, and any other takes a
 * filler's place, or goes on top too when there's no filler to give up. So a focus never costs a main
 * lift or makes a workout much longer. On the muscle's own day (tier 1 below) a pick goes straight after
 * the main lifts and any medium or hard pick before it, whatever it costs: it's the work the day is
 * for. Any other pick goes there when it's medium or hard, and last when it's light. A muscle that
 * can't join this day waits for its own.
 *
 * A Focus muscle that can't join this day and is still short may get one light exercise mainly for it
 * here, so a muscle trained one day a week gets a second. One a workout, and placed last. Not within
 * REST_DAYS of its last main work, and not the day before its own day, so it comes rested to the work
 * that counts most. Its own day's work comes before this: when that day comes while today's work still
 * counts in the share (`upcoming`), the share that day will have keeps a new exercise's sets for it,
 * and only what's over that goes on the light exercise here. What's older than 7 days by then doesn't
 * count, so it isn't kept.
 *
 * Last, a muscle still short gets a set more on exercises already planned for it, up to
 * MAX_EXTRA_SETS a workout and one an exercise. A muscle trained one day a week can't reach its range
 * with new exercises alone. Never on a hard exercise or a medium main lift, so the main lifts keep
 * their sets: light ones first, then medium. A light exercise is a main lift only by its place. Only on
 * what the user has done, since a set more copies a usual one. So a pick can take one from the second
 * time it comes in, but not on its first. Light work on another day stays as it is, and so does
 * a Sometimes exercise. With nothing that qualifies, the muscle waits.
 *
 * Both new exercises and sets more go in this order:
 *  1. Chest, back and legs muscles this day's type trains (see isBig). Today is their main chance.
 *  2. A chest, back or legs muscle's light exercise on another day: its only other chance in the week.
 *  3. Small muscles, which can join any day. Missing a day only means waiting for the next one.
 * Within each, the furthest short first. Big muscles also take turns: one that got nothing from Focus
 * over the last 7 days goes first in its tier, of those the one that got least the week before. Small
 * muscles don't: being short already says how long they waited.
 *
 * All of it shares Focus's share of the week, `week` (see focusWeek): a new exercise costs its planned
 * sets, a set more costs one, and with the share used up Focus adds nothing more. The first big muscle
 * in line that's waiting has what it needs kept for it: a new exercise's sets while today can't serve
 * it, or the whole share left when today can but that's too little, so it comes first again next time.
 * A muscle trained one day a week would otherwise find the week's share gone by its day. When its day
 * comes later in the week, what's kept is measured by the share that day will have. It's kept from
 * muscles in its own tier and the ones after, never from a tier before: the day's own big muscles take
 * what they need first. Nothing is kept for a small muscle. Nothing may take the workout past `maxSets`, its usual length and a
 * little more; a pick that can't go on top for that can still take a filler's place, since the workout
 * then stays as long as it was. `held` says which limit kept something out.
 */
export function applyFocus(plan: FocusPlan, goals: RegionGoals, week: RegionSets, exercises: Map<string, Exercise>): FocusFit {
  const exerciseIds = [...plan.exerciseIds];
  const picks: FocusPick[] = [];
  const extra: FocusExtra[] = [];
  let sometimes: SometimesPick | undefined;
  let held: FocusHeld | undefined;
  let room = plan.week ? focusRoom(plan.week) : Infinity;
  const given = new Map(plan.week?.given ?? []);
  const done = [...plan.recent, ...plan.older];
  const equipment = new Set(plan.recent.map((id) => exercises.get(id)!.equipment));
  const untried = [...exercises.values()]
    .filter((e) => !done.includes(e.id))
    .sort((a, b) => Number(!equipment.has(a.equipment)) - Number(!equipment.has(b.equipment)) || Number(a.compound) - Number(b.compound))
    .map((e) => e.id);

  const mainOf = (id: string) => regionsOf(exercises.get(id)!).main;
  const helpersOf = (id: string) => regionsOf(exercises.get(id)!).helpers;
  const muscleOf = (id: string) => exercises.get(id)!.muscle;
  const pointsOf = (id: string) => difficultyPoints(exercises.get(id)!);
  const isHeavy = (id: string) => difficultyOf(exercises.get(id)!) !== 'light';
  const worksFor = (ids: string[], region: BodyRegion) =>
    ids.filter((id) => mainOf(id).includes(region)).length + HELPER_WEIGHT * ids.filter((id) => helpersOf(id).includes(region)).length;
  const planned = (id: string) => plan.setsOf?.(id) ?? PLANNED_SETS;
  const workoutSets = () => exerciseIds.reduce((sum, id) => sum + planned(id), 0) + extra.length;
  /** Adding `sets` keeps the workout within its usual length, or no longer than it already was. */
  const fitsTime = (sets: number) => plan.maxSets === undefined || sets <= 0 || workoutSets() + sets <= plan.maxSets;
  /** What Focus has added today. */
  let spent = 0;
  const giveTo = (region: BodyRegion, sets: number) => {
    room -= sets;
    spent += sets;
    given.set(region, (given.get(region) ?? 0) + sets);
  };
  const shortBy = (region: BodyRegion) =>
    regionRange(region, 'focus').low -
    setsOf(week, region) -
    PLANNED_SETS * worksFor(exerciseIds, region) -
    worksFor(extra.map((e) => e.exerciseId), region);
  /**
   * A big muscle that got nothing from Focus over the last 7 days is waiting its turn. Without `week`,
   * none is. A small muscle never waits: it can join any day, so it just goes by how short it is.
   */
  const waiting = (region: BodyRegion) => plan.week !== undefined && isBig(region) && (given.get(region) ?? 0) < 1;
  const lately = (region: BodyRegion) => (plan.week && isBig(region) ? (given.get(region) ?? 0) + (plan.week.earlier.get(region) ?? 0) : 0);
  const joins = (muscle: Muscle) => plan.groups.includes(groupOf(muscle)) || plan.partners.includes(muscle) || ANY_DAY.includes(muscle);
  const canPick = (id: string, region: BodyRegion) =>
    mainOf(id).includes(region) && !exerciseIds.includes(id) && !plan.leftOut.includes(id) && !plan.avoid?.has(id) && joins(muscleOf(id));
  const fillers = () =>
    exerciseIds.filter(
      (id) => !plan.anchors.includes(id) && !plan.due?.includes(id) && !plan.partners.includes(muscleOf(id)) && !mainOf(id).some((region) => goals[region] === 'focus'),
    );
  /** The last filler, or better, the last one for a muscle that's only being held. */
  const fillerToSwap = () => {
    const swappable = fillers();
    const held = swappable.filter((id) => mainOf(id).length && mainOf(id).every((region) => goals[region] === 'maintain'));
    return held.at(-1) ?? swappable.at(-1);
  };
  /** The last filler for another muscle this exercise is mainly for: the day doesn't need that work twice. */
  const sameWork = (id: string, region: BodyRegion) => {
    const others = mainOf(id).filter((other) => other !== region);
    return fillers().filter((filler) => mainOf(filler).some((other) => others.includes(other))).at(-1);
  };
  /** Within ROOM of the usual cost, or no harder than the plan already was. */
  const withinLimit = (id: string, replaced?: string) => {
    const total = exerciseIds.reduce((sum, other) => sum + pointsOf(other), 0);
    return total + pointsOf(id) - (replaced ? pointsOf(replaced) : 0) <= Math.max(plan.usualPoints + ROOM, total);
  };
  /** What came in straight after the main lifts, in the order it came. */
  const upFront: string[] = [];
  /**
   * Straight after the main lifts and any heavy addition before it, when it's heavy or for the
   * muscle's own day; a light one for its own day also goes after any before it. Otherwise last.
   */
  const place = (id: string, ownDay = false) => {
    if (!isHeavy(id) && !ownDay) {
      exerciseIds.push(id);
      return;
    }
    const ahead = [...plan.anchors, ...upFront.filter((other) => isHeavy(other) || !isHeavy(id))];
    exerciseIds.splice(Math.max(...ahead.map((other) => exerciseIds.indexOf(other))) + 1, 0, id);
    upFront.push(id);
  };

  let onTop = false;
  /**
   * The muscle first in line. While it waits, what it needs is kept for it: a new exercise's sets when
   * it can't be served today, or all of it when it can but the room is too small, so it comes first next time.
   * It's kept from muscles in its own tier and the ones after, never from a tier before it.
   */
  let first: BodyRegion | undefined;
  let firstBlocks = false;
  const roomFor = (region: BodyRegion) => {
    if (first === undefined || region === first || !waiting(first) || tierOf(region) < tierOf(first)) return room;
    if (firstBlocks) return 0;
    // Waiting for its own day later in the week, it needs the room that day will have: older work no longer counts by then.
    const ownDay = tierOf(first) === 2 ? daysToOwnDay(first) : undefined;
    return ownDay === undefined ? room - PLANNED_SETS : Math.min(room, roomLater(ownDay) - PLANNED_SETS);
  };
  /**
   * Too little room for `sets`, today or, with `later` the room the muscle's own day will have, for a new
   * exercise there after these: notes why.
   */
  const noRoom = (region: BodyRegion, sets: number, later = Infinity) => {
    const fitsToday = sets <= roomFor(region);
    if (fitsToday && sets + PLANNED_SETS <= later) return false;
    // Only what its own day needs kept it out, and that day is when it comes first.
    if (fitsToday) {
      held ??= 'ownDay';
      return true;
    }
    held ??= sets <= room ? 'turn' : 'week';
    if (region === first && sets <= (plan.week?.budget ?? Infinity)) firstBlocks = true;
    return true;
  };
  /**
   * Brings `id` in for `region` if it fits: in the place of `overlap`, the filler for its other main
   * muscle, or else on top, or in the place of a filler.
   */
  const tryPick = (id: string, region: BodyRegion, overlap: string | undefined, otherDay = false): boolean => {
    const roomOnTop = overlap === undefined && exerciseIds.length < plan.max && withinLimit(id);
    const fitsOnTop = roomOnTop && fitsTime(planned(id));
    const replaced = fitsOnTop && !onTop ? undefined : (overlap ?? fillerToSwap());
    // With no filler to give up its place, a second one can go on top too, if that fits.
    const goesOnTop = replaced === undefined && fitsOnTop;
    if (!goesOnTop && (replaced === undefined || !withinLimit(id, replaced) || !fitsTime(planned(id) - planned(replaced)))) {
      // It would have gone on top but for the workout's length.
      if (roomOnTop && !fitsOnTop && (!onTop || replaced === undefined)) held ??= 'time';
      return false;
    }
    // Its own day comes while today's work still counts: that day's work is kept first.
    const ownDay = otherDay ? daysToOwnDay(region) : undefined;
    if (noRoom(region, planned(id), ownDay === undefined ? Infinity : roomLater(ownDay))) return false;
    giveTo(region, planned(id));
    const pick: FocusPick = { exerciseId: id, region, fresh: !done.includes(id) };
    if (goesOnTop) onTop = true;
    else {
      exerciseIds.splice(exerciseIds.indexOf(replaced!), 1);
      pick.replaced = replaced;
    }
    if (overlap !== undefined) pick.overlap = mainOf(overlap).find((other) => other !== region && mainOf(id).includes(other));
    if (otherDay) pick.otherDay = true;
    place(id, tierOf(region) === 1);
    picks.push(pick);
    return true;
  };

  for (const id of plan.due ?? []) {
    const last = plan.lastDone?.get(id);
    if (exerciseIds.includes(id)) {
      sometimes = { exerciseId: id, last };
      break;
    }
    const muscle = muscleOf(id);
    const sameMuscle = exerciseIds.filter((other) => !plan.anchors.includes(other) && muscleOf(other) === muscle).at(-1);
    if (!joins(muscle) || (sameMuscle === undefined && (plan.leftOut.includes(id) || plan.full?.(id)))) continue;
    const goesOnTop = sameMuscle === undefined && exerciseIds.length < plan.max && withinLimit(id);
    const replaced = goesOnTop ? undefined : (sameMuscle ?? fillerToSwap());
    if (replaced === undefined && exerciseIds.length >= plan.max) continue;
    if (replaced === undefined) onTop = true;
    else exerciseIds.splice(exerciseIds.indexOf(replaced), 1);
    place(id);
    sometimes = replaced === undefined ? { exerciseId: id, last } : { exerciseId: id, last, replaced };
    break;
  }

  const candidates = [...done, ...untried];
  // Light work for a muscle on another day than its own: rested from its main work and not due tomorrow.
  const today = plan.today;
  const nextJoins = (muscle: Muscle) => !!plan.nextGroups && (plan.nextGroups.includes(groupOf(muscle)) || !!plan.nextPartners?.includes(muscle));
  /** Days until the first type ahead that trains this region, while what's added today still counts then. */
  const daysToOwnDay = (region: BodyRegion) => {
    const days = plan.upcoming?.find(({ groups, partners }) => groups.includes(groupOf(MUSCLE_OF[region])) || partners.includes(MUSCLE_OF[region]))?.days;
    return days !== undefined && days < DAYS_IN_WEEK ? days : undefined;
  };
  /** What Focus's share will have left `days` from now, with what's added today: what's older by then no longer counts. */
  const roomLater = (days: number) => {
    if (!plan.week) return Infinity;
    const { budget, given, byDaysAgo } = plan.week;
    const still = byDaysAgo
      ? byDaysAgo.reduce((sum, sets, daysAgo) => sum + (daysAgo + days < DAYS_IN_WEEK ? sets : 0), 0)
      : [...given.values()].reduce((sum, sets) => sum + sets, 0);
    return budget - still - spent;
  };
  const rested = (region: BodyRegion) => {
    const last = plan.lastMain?.get(region);
    return last === undefined || daysBetween(last, today!) >= REST_DAYS;
  };
  const canPickOtherDay = (id: string, region: BodyRegion) =>
    mainOf(id).includes(region) &&
    !isHeavy(id) &&
    !exerciseIds.includes(id) &&
    !plan.leftOut.includes(id) &&
    !plan.avoid?.has(id) &&
    !joins(muscleOf(id)) &&
    !nextJoins(muscleOf(id));
  const otherDayFor = (region: BodyRegion) => today !== undefined && rested(region) && !exerciseIds.some((id) => mainOf(id).includes(region));

  // 1: a big muscle of this day's type or its partners. 2: another big muscle, mostly for light work
  // here. 3: a small muscle. Read before any pick, so it holds for the sets more too.
  const short = BODY_REGIONS.filter((region) => goals[region] === 'focus' && shortBy(region) > 0);
  const tierOf = (region: BodyRegion) => (!isBig(region) ? 3 : joins(MUSCLE_OF[region]) ? 1 : 2);
  // A deadlift can join a back day for glutes or hamstrings as it is; anything else for them only as light work.
  const own = new Set(short.filter((region) => candidates.some((id) => canPick(id, region))));
  /** Tiers, then turns among big muscles: one that's waiting, then the one that got least over two weeks. Then the furthest short. */
  const byPriority = (a: BodyRegion, b: BodyRegion) =>
    tierOf(a) - tierOf(b) || Number(waiting(b)) - Number(waiting(a)) || lately(a) - lately(b) || shortBy(b) - shortBy(a);
  const order = short.sort(byPriority);
  // Only a big muscle can be waiting, so room is never kept for a small one.
  first = order.find(waiting);
  let otherDayDone = false;
  for (const region of order) {
    if (picks.length >= MAX_FOCUS) break;
    // A pick for an earlier muscle may have covered this one.
    if (shortBy(region) <= 0) continue;
    if (own.has(region)) {
      for (const id of candidates) if (canPick(id, region) && tryPick(id, region, sameWork(id, region))) break;
    } else if (!otherDayDone && otherDayFor(region)) {
      otherDayDone = candidates.some((id) => canPickOtherDay(id, region) && tryPick(id, region, undefined, true));
    }
  }

  // What the new exercises leave short gets a set more on what's planned for it: the muscle furthest
  // short first, one set at a time, and on its lightest exercise first. Never on a hard exercise, and
  // a medium one only when it isn't a main lift, so the main lifts keep their sets. A light exercise is a
  // main lift only by its place, and a set more on it is a few easy minutes.
  // Only on what the user has done, since a set more copies a usual one: a pick that's been done before
  // can take one, and a new one can't. Light work on another day stays light, and Sometimes stays as it is.
  const keepsItsSets = new Set([...picks.filter((pick) => pick.otherDay).map((pick) => pick.exerciseId), ...(sometimes ? [sometimes.exerciseId] : [])]);
  const canTakeMore = (id: string) => {
    const level = difficultyOf(exercises.get(id)!);
    return level === 'light' || (level === 'medium' && !plan.anchors.includes(id));
  };
  const takesExtra = (id: string) => done.includes(id) && canTakeMore(id) && !keepsItsSets.has(id) && !extra.some((e) => e.exerciseId === id);
  const lightestFor = (region: BodyRegion) =>
    exerciseIds
      .filter((id) => mainOf(id).includes(region) && takesExtra(id))
      .sort((a, b) => pointsOf(a) - pointsOf(b))
      .at(0);
  // A set more for small muscles alone is free (see extraCounts): it goes on once the share is used.
  const free = (id: string) => !extraCounts(exercises.get(id)!, goals);
  let shareUsed = false;
  while (extra.length < MAX_EXTRA_SETS) {
    const next = BODY_REGIONS.filter((region) => goals[region] === 'focus' && shortBy(region) > 0)
      .sort(byPriority)
      .map((region) => ({ region, exerciseId: lightestFor(region) }))
      .find((candidate) => candidate.exerciseId !== undefined && (!shareUsed || free(candidate.exerciseId)));
    if (!next) break;
    if (!fitsTime(1)) {
      held ??= 'time';
      break;
    }
    if (free(next.exerciseId!)) {
      extra.push({ exerciseId: next.exerciseId!, region: next.region });
      continue;
    }
    if (noRoom(next.region, 1)) {
      shareUsed = true;
      continue;
    }
    giveTo(next.region, 1);
    extra.push({ exerciseId: next.exerciseId!, region: next.region });
  }
  return held ? { exerciseIds, picks, extra, sometimes, held } : { exerciseIds, picks, extra, sometimes };
}
