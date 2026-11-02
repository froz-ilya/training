import { difficultyOf, difficultyPoints } from '../catalog/difficulty';
import { groupOf, type MuscleGroup } from '../catalog/groups';
import { BODY_REGIONS, regionsOf } from '../catalog/regions';
import { daysBetween } from '../dates';
import type { BodyRegion, Exercise, Muscle, RegionGoal } from '../types';
import { regionRange } from './balance';
import { SMALL } from './budget';
import { HELPER_WEIGHT } from './fatigue';
import type { FocusPick, RotationWorkout } from './next';
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
const PLANNED_SETS = 3;
/** A workout stays the user's own: the accent is a part of it. */
const MAX_FOCUS = 2;
/** A starting value: a Focus exercise may make a workout a little harder than usual, not a lot. */
const ROOM = 1;
/** Muscles that round off any day. Chest, back and legs wait for their own. */
const ANY_DAY: readonly Muscle[] = ['shoulders', ...SMALL];

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

/** Everything it's mainly for is on Maintain, and each of those has had enough this week. */
export function heldEnough(exercise: Exercise, goals: RegionGoals, week: RegionSets): boolean {
  const { main } = regionsOf(exercise);
  return main.length > 0 && main.every((region) => goals[region] === 'maintain' && setsOf(week, region) >= regionRange(region, 'maintain').low);
}

/** It's mainly for a Focus muscle that hasn't reached its range this week. */
export function trainsShortFocus(exercise: Exercise, goals: RegionGoals, week: RegionSets): boolean {
  return regionsOf(exercise).main.some((region) => goals[region] === 'focus' && setsOf(week, region) < regionRange(region, 'focus').low);
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
}

export interface FocusFit {
  exerciseIds: string[];
  picks: FocusPick[];
  /** One a workout, so the workout stays the user's own. */
  sometimes?: SometimesPick;
}

/**
 * First, the first Sometimes exercise that's due and can join this day takes the place of a filler for
 * its muscle. With none, it waits if its muscle has had enough this week, or else goes on top if that
 * fits, or takes another filler's place. Those places have no limit on difficulty. A Focus pick comes
 * back every week, but this comes round every three, and a limit would keep out exactly the hard
 * exercises the mark is for.
 *
 * Then it brings in work for the Focus muscles that are short this week, the shortest first, one
 * exercise for each. What the user has done comes first, and only then something new. It can't take
 * the workout more than ROOM over its usual cost, or the next one is tried, and with none left the
 * muscle goes without today. An exercise that also trains what a filler trains takes that filler's place.
 * Otherwise the first goes on top if the workout has room and that fits, and any other takes a
 * filler's place, so a focus never costs a main lift or makes a workout much longer. Medium and hard
 * picks go straight after the main lifts, and light ones last. A muscle that can't join this day
 * waits for its own.
 */
export function applyFocus(plan: FocusPlan, goals: RegionGoals, week: RegionSets, exercises: Map<string, Exercise>): FocusFit {
  const exerciseIds = [...plan.exerciseIds];
  const picks: FocusPick[] = [];
  let sometimes: SometimesPick | undefined;
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
  const plannedFor = (region: BodyRegion) =>
    exerciseIds.filter((id) => mainOf(id).includes(region)).length + HELPER_WEIGHT * exerciseIds.filter((id) => helpersOf(id).includes(region)).length;
  const shortBy = (region: BodyRegion) => regionRange(region, 'focus').low - setsOf(week, region) - PLANNED_SETS * plannedFor(region);
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
  /** Straight after the main lifts and any heavy pick before it, or last when it's light. */
  const place = (id: string) => {
    if (!isHeavy(id)) {
      exerciseIds.push(id);
      return;
    }
    const brought = [...(sometimes ? [sometimes] : []), ...picks].map((pick) => pick.exerciseId);
    const ahead = [...plan.anchors, ...brought.filter(isHeavy)];
    exerciseIds.splice(Math.max(...ahead.map((other) => exerciseIds.indexOf(other))) + 1, 0, id);
  };

  let onTop = false;
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
  const order = BODY_REGIONS.filter((region) => goals[region] === 'focus' && shortBy(region) > 0).sort((a, b) => shortBy(b) - shortBy(a));
  for (const region of order) {
    if (picks.length >= MAX_FOCUS) break;
    // A pick for an earlier muscle may have covered this one.
    if (shortBy(region) <= 0) continue;
    for (const id of candidates) {
      if (!canPick(id, region)) continue;
      const overlap = sameWork(id, region);
      const goesOnTop = overlap === undefined && !onTop && exerciseIds.length < plan.max && withinLimit(id);
      const replaced = goesOnTop ? undefined : (overlap ?? fillerToSwap());
      if (!goesOnTop && (replaced === undefined || !withinLimit(id, replaced))) continue;
      const pick: FocusPick = { exerciseId: id, region, fresh: !done.includes(id) };
      if (goesOnTop) onTop = true;
      else {
        exerciseIds.splice(exerciseIds.indexOf(replaced!), 1);
        pick.replaced = replaced;
      }
      if (overlap !== undefined) pick.overlap = mainOf(overlap).find((other) => other !== region && mainOf(id).includes(other));
      place(id);
      picks.push(pick);
      break;
    }
  }
  return { exerciseIds, picks, sometimes };
}
