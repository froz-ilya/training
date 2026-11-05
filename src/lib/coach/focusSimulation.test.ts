import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog/exercises';
import { BODY_REGIONS } from '../catalog/regions';
import { fromISODate, toISODate } from '../dates';
import type { BodyRegion, Exercise, RegionGoal } from '../types';
import { bodyLoad, regionRange, regionStatus, type RegionStatus, type SetRange } from './balance';
import { planNextType, type FocusExtra, type FocusPick, type RotationWorkout } from './next';

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

const workout = (date: string, exerciseIds: string[], extra: FocusExtra[] = []): RotationWorkout => ({
  id: date,
  date,
  exerciseIds,
  workSets: Object.fromEntries(exerciseIds.map((id) => [id, SETS + extra.filter((e) => e.exerciseId === id).length])),
});

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
  for (let week = 0; week < historyWeeks; week++) {
    for (const day of WORKOUT_DAYS) history.push(workout(addDays(START, week * 7 + day), rotation[history.length % rotation.length]));
  }

  const days: PlannedDay[] = [];
  for (let week = historyWeeks; week < historyWeeks + weeks; week++) {
    for (const day of WORKOUT_DAYS) {
      const date = addDays(START, week * 7 + day);
      const plan = planNextType(history, exercises, { today: date, perWeek: WORKOUT_DAYS.length }, {}, goals);
      if (!plan) throw new Error(`nothing planned on ${date}`);
      const extraSets = plan.extraSets ?? [];
      days.push({ date, key: plan.key, exerciseIds: plan.exerciseIds, focus: plan.focus, extraSets });
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

  // Later targets, not reached yet: flip `it.fails` to `it` once they are. Measured with extraSets
  // and light work on another day: hamstrings 4/wk (9-24) alongside quads; with five muscles,
  // sideDelts 8 and biceps 8 (9-30), quads 11 (12-30) and hamstrings 4, while chest reaches 12.
  it.fails('brings quads and hamstrings both into range', () => {
    const run = runs['quads+hamstrings'];
    for (const region of ['quads', 'hamstrings'] as const) expect(run.regions[region].status, `${region}\n${table(run)}`).toBe('normal');
  });

  it.fails('brings five Focus muscles all into range', () => {
    const run = runs['five muscles'];
    for (const region of ['chest', 'quads', 'hamstrings', 'sideDelts', 'biceps'] as const) {
      expect(run.regions[region].status, `${region}\n${table(run)}`).toBe('normal');
    }
  });
});
