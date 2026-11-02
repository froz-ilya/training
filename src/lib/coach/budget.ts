import { groupOf, type MuscleGroup } from '../catalog/groups';
import { daysBetween } from '../dates';
import type { Exercise, Muscle } from '../types';
import type { RotationWorkout } from './next';
import { median } from './position';

/** How many exercises a muscle usually gets in a week, so the planner doesn't pile on more. */

/** The last weeks with workouts that set a muscle's usual count. */
const TRAINED_WEEKS = 12;
/** With fewer of those weeks there's no rhythm to go by, so there's no rule at all. */
const MIN_TRAINED_WEEKS = 4;
/** A muscle seen in fewer of them has no rhythm of its own yet. */
const MIN_MUSCLE_WEEKS = 3;
const DAYS_IN_WEEK = 7;
/** Muscles that move between workout types, so they can be added to one that doesn't usually have them. */
export const SMALL: readonly Muscle[] = ['biceps', 'triceps', 'forearms', 'abs', 'calves'];

export interface MuscleBudget {
  /** Exercises in a usual week. */
  usual: number;
  /** Exercises in the last 7 days. */
  done: number;
}

/** What a workout really worked: its known exercises with work sets, or all of them with none noted. */
export function workedExercises(workout: RotationWorkout, exercises: Map<string, Exercise>): string[] {
  const known = workout.exerciseIds.filter((id) => exercises.has(id));
  const worked = known.filter((id) => workout.workSets[id]);
  return worked.length ? worked : known;
}

/**
 * Each muscle's usual week and its last 7 days. Weeks are counted back from today rather than from
 * Monday: abs on Sunday and again on Monday are two days running, which calendar weeks would read as
 * two separate weeks. The last 7 days stay out of the usual count, because they're what's compared
 * with it. Weeks with no workouts stay out too, so a holiday doesn't lower it. Empty with too little
 * history, and a muscle with no rhythm of its own has no entry. `notThisWeek` keeps work out of the
 * last 7 days, while it still counts towards the usual week.
 */
export function muscleBudgets(
  workouts: RotationWorkout[],
  exercises: Map<string, Exercise>,
  today: string,
  notThisWeek?: (workout: RotationWorkout, muscle: Muscle) => boolean,
): Map<Muscle, MuscleBudget> {
  const weeks = new Map<number, Map<Muscle, number>>();
  for (const workout of workouts) {
    const daysAgo = daysBetween(workout.date, today);
    if (daysAgo < 0) continue;
    const week = Math.floor(daysAgo / DAYS_IN_WEEK);
    const counts = weeks.get(week) ?? new Map<Muscle, number>();
    weeks.set(week, counts);
    for (const id of workedExercises(workout, exercises)) {
      const muscle = exercises.get(id)!.muscle;
      if (week === 0 && notThisWeek?.(workout, muscle)) continue;
      counts.set(muscle, (counts.get(muscle) ?? 0) + 1);
    }
  }
  const trained = [...weeks.keys()].filter((week) => week > 0).sort((a, b) => a - b).slice(0, TRAINED_WEEKS);
  const budgets = new Map<Muscle, MuscleBudget>();
  if (trained.length < MIN_TRAINED_WEEKS) return budgets;
  const lastDays = weeks.get(0);
  for (const muscle of new Set(trained.flatMap((week) => [...weeks.get(week)!.keys()]))) {
    const perWeek = trained.map((week) => weeks.get(week)!.get(muscle) ?? 0);
    if (perWeek.filter(Boolean).length < MIN_MUSCLE_WEEKS) continue;
    budgets.set(muscle, { usual: Math.round(median(perWeek)), done: lastDays?.get(muscle) ?? 0 });
  }
  return budgets;
}

export interface WeekPlan {
  /** The plan as the rotation built it. */
  exerciseIds: string[];
  /** Main lifts: never removed. */
  anchors: string[];
  /** The type's groups: their muscles are never limited. */
  groups: MuscleGroup[];
  /** Muscles this type's days usually train too: not limited unless other days had their week's worth. */
  partners: Muscle[];
  /** Muscles another type's days usually train: they wait for that day rather than move here. */
  elsewhere: Muscle[];
  /** The slots to aim for, and the fewest exercises to leave. */
  size: number;
  min: number;
  /** The variant's other exercises, longest ago first. */
  pool: string[];
  /** Exercises the user uses elsewhere that could be brought in, longest ago first. */
  borrowable: string[];
  /** Fillers for a muscle that has had enough by the user's own goal: they go, and don't come back. */
  enough?: (id: string) => boolean;
  /** Fillers the user's own goal asks for: their muscle's usual count doesn't limit them. */
  needed?: (id: string) => boolean;
}

export interface WeekFit {
  exerciseIds: string[];
  /** Exercises taken out because their muscle has had enough this week. */
  leftOut: string[];
  /** Muscles brought in because they're due. */
  added: Muscle[];
  /** The muscle has its usual count, this plan included. */
  reached: (muscle: Muscle) => boolean;
}

/**
 * Fits the slots after the main lifts to the week. A filler whose muscle has reached its usual count
 * goes. Free slots then take the variant's own exercises, a muscle that's due first, and last a small
 * muscle that's due from what the user does elsewhere. A muscle with no budget isn't limited, and one
 * usually done less than weekly still gets one exercise. A partner counts with its day however soon
 * that comes round, because a rotation doesn't keep to seven days. `enough` and `needed` carry the
 * user's goals for parts of the body. Not under `min`.
 */
export function fitWeek(plan: WeekPlan, budgets: Map<Muscle, MuscleBudget>, exercises: Map<string, Exercise>): WeekFit {
  const muscleOf = (id: string) => exercises.get(id)!.muscle;
  const isPartner = (muscle: Muscle) => {
    const budget = budgets.get(muscle);
    return plan.partners.includes(muscle) && (!budget || budget.done < Math.max(1, budget.usual));
  };
  const budgetOf = (muscle: Muscle) => (plan.groups.includes(groupOf(muscle)) || isPartner(muscle) ? undefined : budgets.get(muscle));
  const planned = new Map<Muscle, number>();
  const count = (muscle: Muscle) => (budgets.get(muscle)?.done ?? 0) + (planned.get(muscle) ?? 0);
  const reached = (muscle: Muscle) => {
    const budget = budgetOf(muscle);
    return budget !== undefined && count(muscle) >= Math.max(1, budget.usual);
  };
  const due = (muscle: Muscle) => {
    const budget = budgetOf(muscle);
    return budget !== undefined && count(muscle) < budget.usual;
  };
  const place = (id: string) => planned.set(muscleOf(id), (planned.get(muscleOf(id)) ?? 0) + 1);

  plan.anchors.forEach(place);
  const leftOut: string[] = [];
  const exerciseIds = plan.exerciseIds.filter((id) => {
    if (plan.anchors.includes(id)) return true;
    if (plan.enough?.(id) || (reached(muscleOf(id)) && !plan.needed?.(id))) {
      leftOut.push(id);
      return false;
    }
    place(id);
    return true;
  });

  const added = new Set<Muscle>();
  const fill = (candidates: string[], wanted: (muscle: Muscle) => boolean) => {
    for (const id of candidates) {
      const muscle = muscleOf(id);
      if (exerciseIds.length >= plan.size) return;
      if (exerciseIds.includes(id) || leftOut.includes(id) || plan.enough?.(id) || reached(muscle) || !wanted(muscle)) continue;
      if (due(muscle)) added.add(muscle);
      place(id);
      exerciseIds.push(id);
    }
  };
  fill(plan.pool, due);
  fill(plan.pool, () => true);
  fill(plan.borrowable, (muscle) => due(muscle) && SMALL.includes(muscle) && !plan.elsewhere.includes(muscle));

  const floor = Math.min(plan.min, plan.exerciseIds.length);
  while (exerciseIds.length < floor) exerciseIds.push(leftOut.shift()!);
  return { exerciseIds, leftOut, added: [...added], reached };
}
