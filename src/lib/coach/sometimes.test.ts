import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog/exercises';
import { toISODate } from '../dates';
import { db } from '../db/schema';
import type { BodyRegion, Exercise, RegionGoal, WorkoutSet } from '../types';
import { loadNextWorkout, sometimesExercises } from './data';
import { planNextType, type NextPick, type RotationPace, type RotationWorkout } from './next';
import { SOMETIMES_DAYS, sometimesState } from './sometimes';

const exercises = new Map<string, Exercise>(CATALOG.map((e) => [e.id, e]));
type Goals = Partial<Record<BodyRegion, RegionGoal>>;

/** A Monday. */
const TODAY = '2026-03-02';
const pace = { today: TODAY, perWeek: 3 };

function daysBefore(days: number): string {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const on = (daysAgo: number, exerciseIds: string[], sets = 3): RotationWorkout => {
  const date = daysBefore(daysAgo);
  return { id: date, date, exerciseIds, workSets: Object.fromEntries(exerciseIds.map((id) => [id, sets])) };
};

const FLAG = 'dragon-flag';
const LIFTS = ['barbell-bench-press', 'incline-dumbbell-press', 'machine-chest-press'];
const CHEST = [...LIFTS, 'pec-deck', 'cable-crunch'];
const LEGS = ['barbell-squat', 'leg-press', 'lying-leg-curl', 'leg-extension', 'seated-leg-curl'];
const withFlag = (day: string[]) => day.map((id) => (id === 'cable-crunch' ? FLAG : id));

/** Chest, legs, chest, legs, all over a week ago, so this week is clear. */
const alternating = (chest: string[] = CHEST, legs: string[] = LEGS): RotationWorkout[] =>
  [20, 18, 16, 14, 12, 10].map((daysAgo, i) => on(daysAgo, i % 2 ? legs : chest));

const planOf = (workouts: RotationWorkout[], marked: string[], goals: Goals = {}, pick: NextPick = { type: 'chest' }, avoid: string[] = []) =>
  planNextType(workouts, exercises, pace, pick, goals, new Set(avoid), new Set(marked))!;

describe('sometimesState', () => {
  const state = (workouts: RotationWorkout[], marked: string[], avoid: string[] = []) => sometimesState(workouts, exercises, new Set(marked), new Set(avoid), TODAY);

  it('has what was never done due, and first', () => {
    expect(state([on(40, ['crunch']), on(30, ['plank'])], ['plank', FLAG, 'crunch']).due).toEqual([FLAG, 'crunch', 'plank']);
  });

  it('counts from the latest time, however long the history', () => {
    const { due, resting, lastDone } = state([on(400, [FLAG]), on(3, [FLAG])], [FLAG]);
    expect(due).toEqual([]);
    expect(resting).toEqual(new Set([FLAG]));
    expect(lastDone.get(FLAG)).toBe(daysBefore(3));
  });

  it('skips what the app doesn’t know, and what the user doesn’t want suggested', () => {
    const { due, resting } = state([], ['no-such-exercise', FLAG], [FLAG]);
    expect(due).toEqual([]);
    expect(resting.size).toBe(0);
  });

  it('doesn’t count an exercise left with no work sets beside ones that had them', () => {
    const workout = { ...on(1, ['pec-deck', FLAG]), workSets: { 'pec-deck': 3 } };
    expect(state([workout], [FLAG]).due).toEqual([FLAG]);
  });
});

describe('an exercise that’s due', () => {
  it('comes in when it was never done, with no date', () => {
    const next = planOf(alternating(), [FLAG]);
    expect(next.exerciseIds).toContain(FLAG);
    expect(next.sometimes).toEqual({ exerciseId: FLAG, replaced: 'cable-crunch' });
    expect(next.sometimes?.last).toBeUndefined();
  });

  it('comes back from beyond everything the rotation looks at', () => {
    const history = [on(200, withFlag(CHEST)), ...Array.from({ length: 32 }, (_, i) => on(90 - i * 2, i % 2 ? LEGS : CHEST))];
    expect(planOf(history, []).exerciseIds).not.toContain(FLAG);
    const next = planOf(history, [FLAG]);
    expect(next.exerciseIds).toContain(FLAG);
    expect(next.exerciseIds).not.toContain('cable-crunch');
    expect(next.sometimes).toEqual({ exerciseId: FLAG, last: daysBefore(200), replaced: 'cable-crunch' });
  });

  it('is due from the day the wait is over, and not the day before', () => {
    const lastDoneAgo = (days: number) => [on(days, withFlag(CHEST)), ...alternating()].sort((a, b) => a.date.localeCompare(b.date));
    expect(SOMETIMES_DAYS).toBe(21);
    expect(planOf(lastDoneAgo(21), [FLAG]).sometimes).toMatchObject({ exerciseId: FLAG, last: daysBefore(21) });
    expect(planOf(lastDoneAgo(20), [FLAG]).sometimes).toBeUndefined();
    expect(planOf(lastDoneAgo(20), [FLAG]).exerciseIds).not.toContain(FLAG);
  });

  it('goes straight after the main lifts when it’s harder than a light exercise', () => {
    const next = planOf(alternating(), [FLAG]);
    expect(next.exerciseIds.indexOf(FLAG)).toBe(3);
  });

  it('counts when the rotation already has it, and replaces nothing', () => {
    const history = [on(30, withFlag(CHEST)), ...alternating()];
    const next = planOf(history, [FLAG]);
    expect(next.exerciseIds).toContain(FLAG);
    expect(next.sometimes).toEqual({ exerciseId: FLAG, last: daysBefore(30) });
  });

  it('takes a place from another muscle’s filler in a full workout with no filler of its own', () => {
    const full = [...LIFTS, 'pec-deck', 'cable-crossover', 'dumbbell-fly'];
    const next = planOf(alternating(full), [FLAG]);
    expect(next.exerciseIds).toEqual([...LIFTS, FLAG, 'pec-deck', 'cable-crossover']);
    expect(next.sometimes).toEqual({ exerciseId: FLAG, replaced: 'dumbbell-fly' });
  });

  it('goes on top when there’s room and it fits', () => {
    const short = [...LIFTS, 'pec-deck'];
    const next = planOf(alternating(short), ['plank']);
    expect(next.exerciseIds).toEqual([...short, 'plank']);
    expect(next.sometimes).toEqual({ exerciseId: 'plank' });
  });

  it('takes a filler’s place when going on top would make the workout too hard', () => {
    const short = [...LIFTS, 'pec-deck'];
    const next = planOf(alternating(short), [FLAG]);
    expect(next.exerciseIds).toEqual([...LIFTS, FLAG]);
    expect(next.sometimes).toEqual({ exerciseId: FLAG, replaced: 'pec-deck' });
  });

  it('comes in however hard it is, since a limit would keep out what the mark is for', () => {
    const next = planOf(alternating(), ['bulgarian-split-squat'], {}, { type: 'legs' });
    expect(next.exerciseIds).toContain('bulgarian-split-squat');
    expect(next.sometimes?.replaced).toBe('seated-leg-curl');
  });

  it('goes on top of a workout that’s all main lifts, even over the limit', () => {
    const next = planOf(alternating(LIFTS), [FLAG]);
    expect(next.exerciseIds).toEqual([...LIFTS, FLAG]);
    expect(next.sometimes).toEqual({ exerciseId: FLAG });
  });

  it('waits for a day that trains its muscle, and a small muscle joins any day', () => {
    expect(planOf(alternating(), ['cable-crossover'], {}, { type: 'legs' }).exerciseIds).not.toContain('cable-crossover');
    expect(planOf(alternating(), ['cable-crossover'], {}, { type: 'legs' }).sometimes).toBeUndefined();
    expect(planOf(alternating(), ['cable-crossover']).exerciseIds).toContain('cable-crossover');
    expect(planOf(alternating(), [FLAG], {}, { type: 'legs' }).exerciseIds).toContain(FLAG);
  });

  it('brings in one a workout, the longest waiting first', () => {
    const history = [on(100, [...LIFTS, 'pec-deck', 'plank']), on(50, [...LIFTS, 'pec-deck', 'crunch']), ...alternating()];
    const next = planOf(history, ['crunch', 'plank']);
    expect(next.sometimes?.exerciseId).toBe('plank');
    expect(next.exerciseIds).not.toContain('crunch');
  });

  it('gives way to the next one when it can’t join this day', () => {
    const next = planOf(alternating(), ['cable-crossover', FLAG], {}, { type: 'legs' });
    expect(next.sometimes?.exerciseId).toBe(FLAG);
  });

  it('adds to the workout once, so a Focus pick doesn’t go on top as well', () => {
    const short = [...LIFTS, 'pec-deck'];
    const next = planOf(alternating(short), ['plank'], { biceps: 'focus' });
    expect(next.exerciseIds.length).toBe(5);
    expect(next.sometimes).toEqual({ exerciseId: 'plank' });
  });

  it('leaves the user’s avoided exercises out, whatever else they’re marked', () => {
    const next = planOf(alternating(), [FLAG], {}, { type: 'chest' }, [FLAG]);
    expect(next.exerciseIds).not.toContain(FLAG);
    expect(next.sometimes).toBeUndefined();
  });

  it('needs today’s date, so nothing happens without a pace', () => {
    const next = planNextType(alternating(), exercises, undefined, { type: 'chest' }, {}, new Set(), new Set([FLAG]))!;
    expect(next.exerciseIds).not.toContain(FLAG);
  });
});

describe('over a season', () => {
  /** Chest then legs every week from TODAY, doing what `act` makes of the plan. Returns the weeks it was planned. */
  function season(weeks: number, act: (plan: string[]) => string[], chest = CHEST) {
    const history = Array.from({ length: 12 }, (_, i) => on(90 - i * 7, chest)).flatMap((w, i) => [w, on(87 - i * 7, LEGS)]);
    const planned: number[] = [];
    const plans: string[][] = [];
    for (let week = 0; week < weeks; week++) {
      const today = daysBefore(-week * 7);
      const weekPace: RotationPace = { today, perWeek: 2 };
      const next = planNextType(history, exercises, weekPace, { type: 'chest' }, {}, new Set(), new Set([FLAG]))!;
      if (next.exerciseIds.includes(FLAG)) planned.push(week);
      plans.push(next.exerciseIds);
      history.push(on(-week * 7, act(next.exerciseIds)));
      history.push(on(-week * 7 - 3, LEGS));
    }
    return { planned, plans };
  }

  it('keeps coming while the user skips it, and never drops out of sight', () => {
    const { planned } = season(30, (plan) => plan.map((id) => (id === FLAG ? 'cable-crunch' : id)));
    expect(planned).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it('comes round about every three weeks when the user does it, not every week', () => {
    const { planned, plans } = season(13, (plan) => plan);
    expect(planned).toEqual([0, 3, 6, 9, 12]);
    expect(plans[1]).toContain('cable-crunch');
    expect(plans[1]).toHaveLength(5);
  });

  it('gives its place back when it took one from another muscle, so it doesn’t stay', () => {
    const { planned, plans } = season(7, (plan) => plan, [...LIFTS, 'pec-deck', 'cable-crossover', 'dumbbell-fly']);
    expect(planned).toEqual([0, 3, 6]);
    expect(plans[1]).toContain('dumbbell-fly');
    expect(plans[1]).toHaveLength(6);
  });
});

describe('an exercise that’s resting', () => {
  const lately = [on(25, CHEST), on(23, LEGS), on(21, CHEST), on(19, LEGS), on(5, withFlag(CHEST)), on(3, LEGS)];

  it('stays out of its slot, and the slot goes back to another exercise', () => {
    const next = planOf(lately, [FLAG]);
    expect(next.exerciseIds).toEqual(CHEST);
    expect(next.sometimes).toBeUndefined();
  });

  it('stays out of the pool, where the rotation would otherwise pick the longest ago', () => {
    const history = [on(25, CHEST), on(23, LEGS), on(14, withFlag(CHEST)), on(12, LEGS), on(5, CHEST), on(3, LEGS)];
    expect(planOf(history, []).exerciseIds).toContain(FLAG);
    expect(planOf(history, [FLAG]).exerciseIds).toEqual(CHEST);
  });

  it('isn’t brought in as a partner muscle’s work', () => {
    const shoulders = [...LIFTS, 'pec-deck', 'lateral-raise'];
    const history = [on(25, shoulders), on(23, LEGS), on(21, shoulders), on(19, LEGS), on(14, [...LIFTS, 'pec-deck', 'cable-crossover']), on(12, LEGS)];
    expect(planOf(history, ['lateral-raise'], {}, { type: 'chest' }).exerciseIds).toContain('lateral-raise');
    const again = [...history.slice(0, 4), on(5, shoulders), on(3, LEGS), on(2, [...LIFTS, 'pec-deck', 'cable-crossover'])];
    expect(planOf(again, ['lateral-raise'], {}, { type: 'chest' }).exerciseIds).not.toContain('lateral-raise');
  });

  it('isn’t picked by Focus', () => {
    const next = planOf(lately, [FLAG], { abs: 'focus' }, { type: 'legs' });
    expect(next.exerciseIds).not.toContain(FLAG);
    expect(next.focus.length).toBeGreaterThan(0);
  });

  it('stays when it leads the workout, since a day needs its main lift', () => {
    const history = [...alternating(), on(5, CHEST), on(3, LEGS)];
    const next = planOf(history, ['barbell-bench-press']);
    expect(next.exerciseIds[0]).toBe('barbell-bench-press');
    expect(next.sometimes).toBeUndefined();
  });

  it('gives up its place when it’s a main lift that doesn’t lead', () => {
    const history = [...alternating(), on(5, CHEST), on(3, LEGS)];
    const next = planOf(history, ['incline-dumbbell-press']);
    expect(next.exerciseIds[0]).toBe('barbell-bench-press');
    expect(next.exerciseIds).not.toContain('incline-dumbbell-press');
  });
});

describe('with the week and Focus', () => {
  /** Chest with abs and legs without, every week: abs usually once a week. */
  const weekly = [44, 37, 30, 23, 16, 9].flatMap((daysAgo) => [on(daysAgo, CHEST), on(daysAgo - 3, LEGS)]);
  const legsDay = { type: 'legs' };

  it('joins a day whose abs still have room', () => {
    expect(planOf(weekly, [FLAG], {}, legsDay).exerciseIds).toContain(FLAG);
  });

  it('waits when its muscle has had its week', () => {
    const next = planOf([...weekly, on(2, CHEST)], [FLAG], {}, legsDay);
    expect(next.exerciseIds).not.toContain(FLAG);
    expect(next.sometimes).toBeUndefined();
  });

  it('still swaps with its own muscle’s filler, which adds nothing to the week', () => {
    const next = planOf(weekly, [FLAG]);
    expect(next.exerciseIds).toContain(FLAG);
    expect(next.sometimes?.replaced).toBe('cable-crunch');
  });

  it('waits when a Maintain muscle has had enough', () => {
    const history = [...alternating(), on(2, CHEST)];
    expect(planOf(history, [FLAG], {}, legsDay).exerciseIds).toContain(FLAG);
    expect(planOf(history, [FLAG], { abs: 'maintain' }, legsDay).exerciseIds).not.toContain(FLAG);
  });

  it('can’t be swapped out by Focus', () => {
    const short = [...LIFTS, 'cable-crunch'];
    const next = planOf(alternating(short), [FLAG], { biceps: 'focus', triceps: 'focus' });
    expect(next.exerciseIds).toContain(FLAG);
    expect(next.focus).toEqual([]);
  });

  it('puts a heavy Focus pick after a heavy Sometimes exercise', () => {
    const history = [on(30, [...LEGS, 'seated-dip-machine']), ...alternating([...LIFTS, 'pec-deck', 'dragon-flag-hold'])];
    const next = planOf(history, [FLAG], { triceps: 'focus' });
    expect(next.focus[0]?.exerciseId).toBe('seated-dip-machine');
    expect(next.exerciseIds.indexOf('seated-dip-machine')).toBeGreaterThan(next.exerciseIds.indexOf(FLAG));
  });

  it('isn’t reported as left out when it came back', () => {
    const plain = [...LIFTS, 'pec-deck', 'cable-crossover', 'dumbbell-fly'];
    const days = [plain, plain, plain, [...LIFTS, 'pec-deck', 'cable-crossover', 'cable-crunch'], [...LIFTS, 'pec-deck', 'cable-crossover', 'cable-crunch'], [...LIFTS, 'pec-deck', 'cable-crunch', FLAG]];
    const history = days.flatMap((day, i) => [on(65 - i * 7, day), on(62 - i * 7, [...LEGS, 'plank'])]);
    expect(planOf(history, []).leftOut).toContain(FLAG);
    const next = planOf(history, [FLAG]);
    expect(next.exerciseIds).toContain(FLAG);
    expect(next.leftOut).not.toContain(FLAG);
    expect(next.sometimes).toMatchObject({ exerciseId: FLAG, replaced: 'cable-crunch' });
  });
});

describe('with nothing marked', () => {
  it('plans exactly as before', () => {
    const history = [...alternating(), on(2, CHEST)];
    for (const goals of [{}, { abs: 'focus' }, { chest: 'maintain' }] as Goals[]) {
      expect(planNextType(history, exercises, pace, {}, goals, new Set(), new Set())).toEqual(planNextType(history, exercises, pace, {}, goals));
    }
    expect(planNextType(history, exercises, pace)!.sometimes).toBeUndefined();
  });
});

describe('the stored setting', () => {
  async function addWorkout(id: string, date: string, exerciseIds: string[]) {
    await db.workouts.add({ id, date, status: 'done', source: 'app', updatedAt: 1 });
    await db.sets.bulkAdd(
      exerciseIds.map((exerciseId, i): WorkoutSet => ({ id: `${id}-${i}`, workoutId: id, exerciseId, date, entry: i + 1, order: 1, kind: 'work', weightKg: 40, reps: 8, done: true })),
    );
  }

  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('reaches the plan, with the date it was last done and what it replaced', async () => {
    const today = new Date();
    const ago = (days: number) => toISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));
    await addWorkout('w0', ago(40), [...LEGS, FLAG]);
    for (let i = 0; i < 6; i++) await addWorkout(`w${i + 1}`, ago(20 - i * 2), i % 2 ? LEGS : CHEST);
    await db.exerciseSettings.put({ exerciseId: FLAG, sometimes: true });
    const next = await loadNextWorkout({ type: 'chest' });
    expect(next?.sometimes?.exercise.id).toBe(FLAG);
    expect(next?.sometimes?.last).toBe(ago(40));
    expect(next?.sometimes?.replaced?.id).toBe('cable-crunch');
    expect(next?.exercises.map((e) => e.exercise.id)).toContain(FLAG);
  });

  it('leaves an avoided exercise out, whatever else it says', async () => {
    await addWorkout('w1', '2026-01-01', CHEST);
    await addWorkout('w2', '2026-01-03', LEGS);
    await addWorkout('w3', '2026-01-05', CHEST);
    await db.exerciseSettings.put({ exerciseId: FLAG, sometimes: true, avoid: true });
    expect((await loadNextWorkout({ type: 'chest' }))?.exercises.map((e) => e.exercise.id)).not.toContain(FLAG);
    expect(await sometimesExercises()).toEqual([]);
  });

  it('lists what’s marked and known', async () => {
    await db.exerciseSettings.bulkPut([{ exerciseId: FLAG, sometimes: true }, { exerciseId: 'plank' }, { exerciseId: 'gone', sometimes: true }]);
    expect((await sometimesExercises()).map((e) => e.id)).toEqual([FLAG]);
  });
});
