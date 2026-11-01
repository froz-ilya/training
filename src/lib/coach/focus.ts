import { groupOf, type MuscleGroup } from '../catalog/groups';
import { BODY_REGIONS, regionsOf } from '../catalog/regions';
import { daysBetween } from '../dates';
import type { BodyRegion, Exercise, Muscle, RegionGoal } from '../types';
import { regionRange } from './balance';
import { SMALL } from './budget';
import { HELPER_WEIGHT } from './fatigue';
import type { FocusPick, RotationWorkout } from './next';

/**
 * The user's goals for parts of the body, as the planner follows them. A Focus muscle that's short
 * this week gets more work, and a Maintain muscle that has had enough gives up its fillers. It only
 * changes which exercises are planned, never their weights, and with no goals it changes nothing.
 */

export type RegionGoals = Partial<Record<BodyRegion, RegionGoal>>;
/** Work sets per region in a week, counted as the body map counts them. */
export type RegionSets = Map<BodyRegion, number>;

const DAYS_IN_WEEK = 7;
/** What an exercise in the plan is taken to add, before its sets are suggested. */
const PLANNED_SETS = 3;
/** A workout stays the user's own: the accent is a part of it. */
const MAX_FOCUS = 2;
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
}

export interface FocusFit {
  exerciseIds: string[];
  picks: FocusPick[];
}

/**
 * Brings in work for the Focus muscles that are short this week, the shortest first, one exercise for
 * each. The first goes on top while the workout has room, and the next takes a filler's place, so a
 * focus never costs a main lift or makes a workout much longer. Both go last. What the user has done
 * comes first, and only then something new. A muscle that can't join this day waits for its own.
 */
export function applyFocus(plan: FocusPlan, goals: RegionGoals, week: RegionSets, exercises: Map<string, Exercise>): FocusFit {
  const exerciseIds = [...plan.exerciseIds];
  const picks: FocusPick[] = [];
  const done = [...plan.recent, ...plan.older];
  const equipment = new Set(plan.recent.map((id) => exercises.get(id)!.equipment));
  const untried = [...exercises.values()]
    .filter((e) => !done.includes(e.id))
    .sort((a, b) => Number(!equipment.has(a.equipment)) - Number(!equipment.has(b.equipment)) || Number(a.compound) - Number(b.compound))
    .map((e) => e.id);

  const mainOf = (id: string) => regionsOf(exercises.get(id)!).main;
  const muscleOf = (id: string) => exercises.get(id)!.muscle;
  const shortBy = (region: BodyRegion) =>
    regionRange(region, 'focus').low - setsOf(week, region) - PLANNED_SETS * exerciseIds.filter((id) => mainOf(id).includes(region)).length;
  const joins = (muscle: Muscle) => plan.groups.includes(groupOf(muscle)) || plan.partners.includes(muscle) || ANY_DAY.includes(muscle);
  const canPick = (id: string, region: BodyRegion) =>
    mainOf(id).includes(region) && !exerciseIds.includes(id) && !plan.leftOut.includes(id) && joins(muscleOf(id));
  /** The last filler, or better, the last one for a muscle that's only being held. */
  const fillerToSwap = () => {
    const fillers = exerciseIds.filter(
      (id) => !plan.anchors.includes(id) && !plan.partners.includes(muscleOf(id)) && !mainOf(id).some((region) => goals[region] === 'focus'),
    );
    const held = fillers.filter((id) => mainOf(id).length && mainOf(id).every((region) => goals[region] === 'maintain'));
    return held.at(-1) ?? fillers.at(-1);
  };

  const order = BODY_REGIONS.filter((region) => goals[region] === 'focus' && shortBy(region) > 0).sort((a, b) => shortBy(b) - shortBy(a));
  let onTop = false;
  for (const region of order) {
    if (picks.length >= MAX_FOCUS) break;
    // A pick for an earlier muscle may have covered this one.
    if (shortBy(region) <= 0) continue;
    const id = [...done, ...untried].find((candidate) => canPick(candidate, region));
    if (id === undefined) continue;
    const fresh = !done.includes(id);
    if (!onTop && exerciseIds.length < plan.max) {
      onTop = true;
      exerciseIds.push(id);
      picks.push({ exerciseId: id, region, fresh });
      continue;
    }
    const replaced = fillerToSwap();
    if (replaced === undefined) continue;
    exerciseIds.splice(exerciseIds.indexOf(replaced), 1);
    exerciseIds.push(id);
    picks.push({ exerciseId: id, region, fresh, replaced });
  }
  return { exerciseIds, picks };
}
