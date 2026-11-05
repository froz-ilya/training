import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog/exercises';
import { BODY_REGIONS } from '../catalog/regions';
import { fromISODate, toISODate } from '../dates';
import type { BodyRegion, Exercise, RegionGoal } from '../types';
import { regionsOf } from '../catalog/regions';
import { bodyLoad, regionRange, regionStatus, type RegionStatus, type SetRange } from './balance';
import { extraCounts, focusWeek } from './focus';
import { planNextType, workoutTypes, type FocusExtra, type FocusPick, type RotationWorkout } from './next';
import { median } from './position';

/**
 * Plays weeks of planned workouts and reads what the Progress body map would show at the end, to
 * check that Focus goals reach their weekly range. A plain push, pull and legs history comes first,
 * then each workout day takes whatever the plan says. The person is invented.
 */

const exercises = new Map<string, Exercise>(CATALOG.map((e) => [e.id, e]));
type Goals = Partial<Record<BodyRegion, RegionGoal>>;

const PUSH = ['barbell-bench-press', 'incline-dumbbell-press', 'lateral-raise', 'rope-pushdown'];
const PULL = ['lat-pulldown', 'seated-cable-row', 'rear-delt-fly', 'dumbbell-curl'];
const LEGS = ['smith-squat', 'bulgarian-split-squat', 'standing-calf-raise', 'dragon-flag', 'dumbbell-shoulder-press'];

/** A Monday. */
const START = '2026-01-05';
const SETS = 3;
const WORKOUT_DAYS = [0, 2, 4];
const MAX_EXERCISES = 6;

const addDays = (date: string, days: number) => {
  const d = fromISODate(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};

/** Minutes a work set takes this person, rest included. */
const MINUTES_PER_SET = 3;

const workout = (date: string, exerciseIds: string[], extra: FocusExtra[] = []): RotationWorkout => {
  const added = Object.fromEntries(exerciseIds.map((id) => [id, extra.filter((e) => e.exerciseId === id).length]));
  const workSets = Object.fromEntries(exerciseIds.map((id) => [id, SETS + added[id]]));
  const sets = Object.values(workSets).reduce((sum, n) => sum + n, 0);
  return { id: date, date, exerciseIds, workSets, extra: added, minutes: sets * MINUTES_PER_SET };
};

interface SimOptions {
  /** Weeks of plain push, pull and legs before goals apply. */
  historyWeeks?: number;
  /** Weeks of planned workouts. */
  weeks?: number;
}

interface PlannedDay {
  date: string;
  key: string;
  exerciseIds: string[];
  focus: FocusPick[];
  extraSets: FocusExtra[];
  /** Focus's share of the 7 days up to this one, and what it had given before this workout. */
  budget: number;
  givenBefore: number;
  /** The type's usual minutes, from the workouts before this one. */
  usualMinutes: number;
}

interface RegionResult {
  perWeek: number;
  range: SetRange;
  status: RegionStatus;
}

interface SimResult {
  goals: Goals;
  regions: Record<BodyRegion, RegionResult>;
  days: PlannedDay[];
}

function simulate(goals: Goals, { historyWeeks = 3, weeks = 6 }: SimOptions = {}): SimResult {
  const rotation = [PUSH, PULL, LEGS];
  const history: RotationWorkout[] = [];
  const keys: string[] = [];
  for (let week = 0; week < historyWeeks; week++) {
    for (const day of WORKOUT_DAYS) {
      keys.push(['chest', 'back', 'legs'][history.length % rotation.length]);
      history.push(workout(addDays(START, week * 7 + day), rotation[history.length % rotation.length]));
    }
  }

  const days: PlannedDay[] = [];
  for (let week = historyWeeks; week < historyWeeks + weeks; week++) {
    for (const day of WORKOUT_DAYS) {
      const date = addDays(START, week * 7 + day);
      const plan = planNextType(history, exercises, { today: date, perWeek: WORKOUT_DAYS.length }, {}, goals);
      if (!plan) throw new Error(`nothing planned on ${date}`);
      const extraSets = plan.extraSets ?? [];
      const { budget, given } = focusWeek(history, exercises, goals, date, workoutTypes(history, exercises, date));
      const usualMinutes = median(history.filter((_, i) => keys[i] === plan.key).slice(-10).map((w) => w.minutes!));
      const givenBefore = [...given.values()].reduce((sum, sets) => sum + sets, 0);
      days.push({ date, key: plan.key, exerciseIds: plan.exerciseIds, focus: plan.focus, extraSets, budget, givenBefore, usualMinutes });
      keys.push(plan.key);
      history.push(workout(date, plan.exerciseIds, extraSets));
    }
  }

  const today = addDays(history[history.length - 1].date, 1);
  const work = history.flatMap((w) => w.exerciseIds.flatMap((exerciseId) => Array.from({ length: w.workSets[exerciseId] }, () => ({ date: w.date, exerciseId }))));
  const load = bodyLoad(work, history.map((w) => w.date), exercises, today);
  const regions = Object.fromEntries(
    load.regions.map((r) => [r.region, { perWeek: r.perWeek, range: regionRange(r.region, goals[r.region]), status: regionStatus(r, goals[r.region]) }]),
  ) as Record<BodyRegion, RegionResult>;
  return { goals, regions, days };
}

/** The body map as text, for assertion messages. */
function table({ goals, regions }: SimResult): string {
  return BODY_REGIONS.map((region) => {
    const { perWeek, range, status } = regions[region];
    const goal = goals[region] ? ` (${goals[region]})` : '';
    return `${region}${goal}: ${perWeek}/wk, range ${range.low}-${range.high}, ${status}`;
  }).join('\n');
}

/** What Focus added to a planned workout from its share, in work sets: a new exercise at its usual three. Sets more for small muscles alone are free. */
const added = (day: PlannedDay, goals: Goals) => day.focus.length * SETS + day.extraSets.filter((e) => extraCounts(exercises.get(e.exerciseId)!, goals)).length;

/** Main work sets each region got in each planned week. */
function mainSetsPerWeek({ days }: SimResult): Map<BodyRegion, number>[] {
  const weeks: Map<BodyRegion, number>[] = [];
  days.forEach((day, i) => {
    const week = (weeks[Math.floor(i / WORKOUT_DAYS.length)] ??= new Map());
    for (const id of day.exerciseIds) {
      const sets = SETS + day.extraSets.filter((e) => e.exerciseId === id).length;
      for (const region of regionsOf(exercises.get(id)!).main) week.set(region, (week.get(region) ?? 0) + sets);
    }
  });
  return weeks;
}

/** One line per planned workout, with what Focus brought in and the extra sets. */
function plans({ days }: SimResult): string {
  return days
    .map(({ date, key, exerciseIds, focus, extraSets }) => {
      const picks = focus.map((f) => (f.replaced ? `${f.exerciseId} for ${f.replaced}` : f.exerciseId)).join(', ');
      return `${date} ${key}: ${exerciseIds.join(', ')} | focus: ${picks || '-'} | extra sets: ${extraSets.map((e) => e.exerciseId).join(', ') || '-'}`;
    })
    .join('\n');
}

const focusOn = (...regions: BodyRegion[]): Goals => Object.fromEntries(regions.map((r) => [r, 'focus']));

const SCENARIOS: Record<string, Goals> = {
  chest: focusOn('chest'),
  quads: focusOn('quads'),
  'quads+hamstrings': focusOn('quads', 'hamstrings'),
  'calves+sideDelts+biceps': focusOn('calves', 'sideDelts', 'biceps'),
  'five muscles': focusOn('chest', 'quads', 'hamstrings', 'sideDelts', 'biceps'),
};

describe('Focus simulation', () => {
  const baseline = simulate({});
  const runs = Object.fromEntries(Object.entries(SCENARIOS).map(([name, goals]) => [name, simulate(goals)]));
  // `FOCUS_SIM_DEBUG=1 npx vitest run --silent=false <this file>` prints every run’s body map and plans.
  if (process.env.FOCUS_SIM_DEBUG) {
    for (const [name, run] of [['no goals', baseline] as const, ...Object.entries(runs)]) console.log(`== ${name}\n${table(run)}\n${plans(run)}`);
  }

  it('plans plain workouts with no goals', () => {
    for (const day of baseline.days) {
      expect(day.focus, `${day.date}: ${day.exerciseIds.join(', ')}`).toEqual([]);
      expect(day.extraSets, `${day.date}: ${day.exerciseIds.join(', ')}`).toEqual([]);
    }
  });

  it('never plans more than six exercises', () => {
    for (const run of [baseline, ...Object.values(runs)]) {
      for (const day of run.days) expect(day.exerciseIds.length, `${day.date}: ${day.exerciseIds.join(', ')}`).toBeLessThanOrEqual(MAX_EXERCISES);
    }
  });

  it('brings small Focus muscles into their range', () => {
    const run = runs['calves+sideDelts+biceps'];
    for (const region of ['calves', 'sideDelts', 'biceps'] as const) expect(run.regions[region].status, `${region}\n${table(run)}`).toBe('normal');
  });

  it('never leaves a muscle without a goal short that was fine without goals', () => {
    for (const [name, run] of Object.entries(runs)) {
      for (const region of BODY_REGIONS) {
        if (run.goals[region] || baseline.regions[region].status !== 'normal') continue;
        expect(run.regions[region].status, `${name}: ${region}\n${table(run)}\n--- no goals ---\n${table(baseline)}`).not.toBe('less');
      }
    }
  });

  // Phase 1: Focus adds sets as well as exercises. Before extraSets: chest 11/wk, quads 9/wk, both
  // less against a Focus range of 12-30. With them: 12 and 12, normal.
  it('brings chest into its Focus range', () => {
    const run = runs.chest;
    expect(run.regions.chest.status, `${table(run)}\n${plans(run)}`).toBe('normal');
  });

  it('brings quads into their Focus range', () => {
    const run = runs.quads;
    expect(run.regions.quads.status, `${table(run)}\n${plans(run)}`).toBe('normal');
  });

  it('keeps the rotation’s order', () => {
    for (const [name, run] of Object.entries(runs)) expect(run.days.map((day) => day.key), `${name}\n${plans(run)}`).toEqual(baseline.days.map((day) => day.key));
  });

  // Phase 2: a light exercise on another day. Before it, with quads and hamstrings both on Focus,
  // quads came to 8/wk; with a leg extension or curl on chest days, quads reach 12.
  it('brings quads into range alongside hamstrings', () => {
    const run = runs['quads+hamstrings'];
    expect(run.regions.quads.status, `${table(run)}\n${plans(run)}`).toBe('normal');
  });

  // Later targets, not reached yet: flip `it.fails` to `it` once it is. Hamstrings start from no work
  // at all and train on one day a week, and they share that day's one free slot with quads. Both are
  // leg muscles, so they take turns: the slot goes to the one that got nothing from Focus over the last
  // 7 days, which here is quads most weeks, since the chest day's leg curl counts for hamstrings.
  // Hamstrings stay at 4/wk (9-24) while quads keep 12.
  it.fails('brings quads and hamstrings both into range', () => {
    const run = runs['quads+hamstrings'];
    for (const region of ['quads', 'hamstrings'] as const) expect(run.regions[region].status, `${region}\n${table(run)}`).toBe('normal');
  });

  // Phase 3: with five Focus muscles, Focus shares out a fifth of the usual week rather than adding
  // two exercises and four sets to every workout. Not all of them reach their range, but each gets
  // its turn.
  it('keeps Focus to its share of the week and each workout near its usual length', () => {
    for (const [name, run] of Object.entries(runs)) {
      for (const day of run.days) {
        const line = `${name} ${day.date}\n${plans(run)}`;
        expect(day.givenBefore + added(day, run.goals), line).toBeLessThanOrEqual(day.budget);
        const grows = day.extraSets.length > 0 || day.focus.some((pick) => !pick.replaced);
        const minutes = (day.exerciseIds.length * SETS + day.extraSets.length) * MINUTES_PER_SET;
        if (grows) expect(minutes, line).toBeLessThanOrEqual(day.usualMinutes + 15);
      }
    }
  });

  /** Every Focus muscle in `regions` got something from Focus, or more main work than without goals, in each block of `weeksPerBlock` weeks. */
  const servedEvery = (weeksPerBlock: number, regions: readonly BodyRegion[]) => {
    const run = runs['five muscles'];
    const weeks = mainSetsPerWeek(run);
    const plain = mainSetsPerWeek(baseline);
    const perWeek = WORKOUT_DAYS.length;
    for (let block = 0; block < weeks.length; block += weeksPerBlock) {
      const days = run.days.slice(block * perWeek, (block + weeksPerBlock) * perWeek);
      const sum = (list: Map<BodyRegion, number>[], region: BodyRegion) =>
        list.slice(block, block + weeksPerBlock).reduce((total, week) => total + (week.get(region) ?? 0), 0);
      for (const region of regions) {
        const picked = days.some((day) => day.focus.some((pick) => pick.region === region) || day.extraSets.some((e) => e.region === region));
        expect(picked || sum(weeks, region) > sum(plain, region), `${region}, weeks ${block + 1}-${block + weeksPerBlock}\n${plans(run)}`).toBe(true);
      }
    }
  };

  // Big muscles come first on their own day, and get light work on another, so each gets its turn
  // within two weeks. Small muscles come after them and can wait, but never a month.
  it('gives each big Focus muscle of five some Focus work at least every other week', () => {
    servedEvery(2, ['chest', 'quads', 'hamstrings']);
  });

  it('gives each small Focus muscle of five some Focus work at least every four weeks', () => {
    servedEvery(4, ['sideDelts', 'biceps']);
  });
});
