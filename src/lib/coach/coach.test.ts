import { describe, expect, it } from 'vitest';
import type { Exercise, StallRecord } from '../types';
import { nextKey, overdueKey, planNextType, rotationKeys, rotationTypeCount, type RotationWorkout } from './next';
import { alternateRange, atRotationLimit, plateauOptions, resolveOutcomes, stallOutcome } from './plateau';
import { beatsAcrossSets, compareExercise, compareSet, pairSets } from './compare';
import { expectedGapDays, weekProgress, weeklyFrequency } from './frequency';
import { adjustPoints, DEFAULT_POSITION_COST, entryRanks, learnPositionCost, positionFactor } from './position';
import { countedPoints, exerciseStatus, findFall, isRising } from './status';
import { atLatestLevel, countedSessions, doneWork, effectiveRows, effectiveSets, estimateSet, leadSet, learnStep, markHeldBack, repRange, restartDate, sessionStrength, sinceBaseline, strengthPoints, topSet, weightStep, type Session, type SessionSet, type StrengthPoint } from './strength';
import { suggestSets, usualWorkSets } from './suggest';
import { calendarWeeks, exerciseRecords, newBests, weeklyVolume, weekStart } from './summary';
import { hasPain, isOffDay } from '../notes/tags';

const press: Exercise = {
  id: 'press',
  names: { en: 'Press', de: 'Drücken', ru: 'Жим' },
  muscle: 'chest',
  equipment: 'barbell',
  load: 'weight',
  compound: true,
};
const raise: Exercise = { ...press, id: 'raise', muscle: 'shoulders', equipment: 'dumbbell', compound: false };
const plank: Exercise = { ...press, id: 'plank', muscle: 'abs', equipment: 'bodyweight', load: 'time', compound: false };
const pullUp: Exercise = { ...press, id: 'pull-up', muscle: 'back', equipment: 'bodyweight', load: 'body' };

function session(date: string, ...work: [number, number][]): Session {
  return { workoutId: date, date, position: 1, sets: work.map(([weightKg, reps]) => ({ kind: 'work', weightKg, reps })) };
}

/** `count` dates, `gap` days apart, starting at the given date. */
function dates(start: string, count: number, gap: number): string[] {
  const d = new Date(`${start}T12:00:00`);
  return Array.from({ length: count }, () => {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    d.setDate(d.getDate() + gap);
    return iso;
  });
}

const points = (values: number[], start = '2026-01-01', gap = 7): StrengthPoint[] =>
  dates(start, values.length, gap).map((date, i) => ({ date, value: values[i] }));

describe('strength', () => {
  it('stops counting reps past the cap', () => {
    const at15 = estimateSet({ kind: 'work', weightKg: 100, reps: 15 }, 'weight', 75);
    const at30 = estimateSet({ kind: 'work', weightKg: 100, reps: 30 }, 'weight', 75);
    expect(at15).toBe(150);
    expect(at30).toBe(at15);
  });

  it('keeps counting reps for unweighted bodyweight work', () => {
    const at20 = estimateSet({ kind: 'work', weightKg: 0, reps: 20 }, 'body', 75);
    const at15 = estimateSet({ kind: 'work', weightKg: 0, reps: 15 }, 'body', 75);
    expect(at20).toBeGreaterThan(at15);
  });

  it('counts body weight for bodyweight exercises', () => {
    expect(estimateSet({ kind: 'work', weightKg: 0, reps: 3 }, 'body', 80)).toBeCloseTo(88);
    expect(estimateSet({ kind: 'work', weightKg: 20, reps: 3 }, 'body', 80)).toBeCloseTo(110);
  });

  it('uses the duration for timed exercises', () => {
    expect(estimateSet({ kind: 'work', weightKg: 0, reps: 0, seconds: 90 }, 'time', 75)).toBe(90);
  });

  it('ignores warm-ups when a session has work sets', () => {
    const s: Session = {
      workoutId: 'a',
      date: '2026-01-01',
      position: 1,
      sets: [
        { kind: 'warmup', weightKg: 100, reps: 15 },
        { kind: 'work', weightKg: 50, reps: 5 },
      ],
    };
    expect(strengthPoints([s], 'weight', 75)[0].value).toBeCloseTo(50 * (1 + 5 / 30));
  });

  it('compares only from the latest baseline', () => {
    const list = [{ date: '2026-01-01' }, { date: '2026-02-01' }, { date: '2026-03-01' }];
    const base = { id: 'b', exerciseId: 'x' };
    expect(sinceBaseline(list, [{ ...base, date: '2026-01-15' }, { ...base, date: '2026-02-15' }])).toEqual([{ date: '2026-03-01' }]);
    expect(sinceBaseline(list, [])).toEqual(list);
  });

  it('falls back to rep ranges by kind of exercise', () => {
    expect(repRange(press)).toEqual({ low: 6, high: 10 });
    expect(repRange(raise)).toEqual({ low: 8, high: 12 });
    expect(repRange(press, { exerciseId: 'press', repLow: 3, repHigh: 5 })).toEqual({ low: 3, high: 5 });
    // A broken stored range is ignored.
    expect(repRange(press, { exerciseId: 'press', repLow: 8, repHigh: 8 })).toEqual({ low: 6, high: 10 });
  });

  it('learns the step from weights, including small cable steps', () => {
    expect(learnStep([60, 62.5, 65, 67.5, 65])).toBe(2.5);
    expect(learnStep([33, 33.625, 34.25, 34.875, 35.5])).toBe(0.625);
    expect(learnStep([60, 62.5])).toBeNull();
  });

  it('prefers the user setting, then history, then the equipment default', () => {
    const history = [session('2026-01-01', [10, 8]), session('2026-01-08', [12.5, 8]), session('2026-01-15', [15, 8])];
    expect(weightStep(press, history, { exerciseId: 'press', stepKg: 1 })).toBe(1);
    expect(weightStep(press, history)).toBe(2.5);
    expect(weightStep({ ...press, equipment: 'machine' }, [])).toBe(5);
  });
});

describe('exerciseStatus', () => {
  const today = '2026-04-01';

  it('calls too little history new', () => {
    expect(exerciseStatus([], { today }).state).toBe('new');
    expect(exerciseStatus(points([100, 102], '2026-03-20', 3), { today }).state).toBe('new');
  });

  it('sees a new best in recent sessions as progressing', () => {
    expect(exerciseStatus(points([100, 102, 104, 106], '2026-03-10', 7), { today }).state).toBe('progressing');
  });

  it('calls four sessions over six weeks without improvement stalled', () => {
    const p = points([100, 100, 99, 100, 100, 99, 100], '2026-02-01', 8);
    const status = exerciseStatus(p, { today });
    expect(status.state).toBe('stalled');
    expect(status.bestDate).toBe('2026-02-01');
  });

  it('needs both the sessions and the weeks', () => {
    // Five sessions in a fortnight: too soon to say.
    expect(exerciseStatus(points([100, 100, 100, 100, 100, 100], '2026-03-20', 2), { today }).state).toBe('holding');
    // Eight weeks but only three sessions after the best.
    expect(exerciseStatus(points([100, 100, 100, 100], '2026-02-01', 19), { today }).state).toBe('holding');
  });

  it('a gain under 1% is not real improvement', () => {
    const p = points([100, 100.4, 100.6, 100.8, 100.9, 100.9, 100.9], '2026-02-01', 8);
    expect(exerciseStatus(p, { today }).state).toBe('stalled');
  });

  it('one bad day changes nothing', () => {
    const steady = [100, 102, 104, 106, 106, 106, 106];
    const bad = [100, 102, 104, 106, 106, 70, 106];
    const a = exerciseStatus(points(steady, '2026-02-01', 7), { today });
    const b = exerciseStatus(points(bad, '2026-02-01', 7), { today });
    expect(b.state).toBe(a.state);
    expect(b.maybeMachineChange).toBe(false);
  });

  it('sees a lasting gradual decline as dropping', () => {
    const p = points([100, 100, 100, 97, 92, 88, 86, 84], '2026-02-01', 7);
    expect(exerciseStatus(p, { today }).state).toBe('dropping');
  });

  it('asks about a machine change instead of calling a sudden fall dropping', () => {
    const p = points([100, 100, 100, 60, 61, 60, 62], '2026-02-01', 7);
    expect(findFall(p)).toBe(3);
    const status = exerciseStatus(p, { today });
    expect(status.maybeMachineChange).toBe(true);
    expect(status.state).not.toBe('dropping');
    expect(status.state).not.toBe('stalled');
    expect(status.best).toBe(62); // only the sessions after the fall are compared
  });

  it('stops asking once the user says it was the same machine', () => {
    const p = points([100, 100, 100, 60, 61, 60, 62], '2026-02-01', 7);
    const status = exerciseStatus(p, { today, ignoreFall: true });
    expect(status.maybeMachineChange).toBe(false);
    expect(status.state).toBe('dropping');
  });

  it('marks a long gap as returning, before and just after coming back', () => {
    expect(exerciseStatus(points([100, 102, 104], '2026-02-01', 7), { today }).state).toBe('returning');
    const back = [...points([100, 102, 104, 106], '2026-01-01', 7), { date: '2026-03-30', value: 100 }];
    expect(exerciseStatus(back, { today }).state).toBe('returning');
  });

  it('sees a stall straight after a break once the numbers are back', () => {
    const before = points([100, 100, 100, 100, 100, 100], '2026-01-05', 7);
    const after = points([100, 100], '2026-04-01', 3);
    expect(exerciseStatus([...before, ...after], { today: '2026-04-05' }).state).toBe('stalled');
  });

  it('stays returning while the numbers are still below the best', () => {
    const before = points([100, 100, 100, 100, 100, 100], '2026-01-05', 7);
    const after = points([88, 90], '2026-04-01', 3);
    expect(exerciseStatus([...before, ...after], { today: '2026-04-05' }).state).toBe('returning');
  });

  it('compares with the last year, not a best from years ago', () => {
    const old = points([140, 140, 140], '2024-01-01', 7);
    const recent = points([100, 101, 102, 104, 106], '2026-02-02', 7);
    const status = exerciseStatus([...old, ...recent], { today: '2026-03-15' });
    expect(status.state).toBe('progressing');
    expect(status.best).toBe(106);
  });

  it('does not call an exercise done monthly returning', () => {
    const p = points([100, 102, 104, 106, 108, 110], '2025-12-01', 24);
    expect(exerciseStatus(p, { today }).state).not.toBe('returning');
  });

  it('a maintain goal is never stalled', () => {
    const p = points([100, 100, 99, 100, 100, 99, 100], '2026-02-01', 8);
    expect(exerciseStatus(p, { today, goal: 'maintain' }).state).toBe('holding');
  });
});

describe('suggestSets', () => {
  const today = '2026-03-05';
  const last = '2026-03-02';

  it('has nothing to say with no history', () => {
    expect(suggestSets(press, [], { today })).toBeNull();
  });

  it('goes up one step at the top of the range', () => {
    const history = [session('2026-02-20', [57.5, 8]), session('2026-02-26', [60, 8]), session(last, [62.5, 10], [62.5, 8])];
    const s = suggestSets(press, history, { today })!;
    expect(s.reason).toBe('up');
    expect(s.weightKg).toBe(65);
    expect(s.reps).toBe(6);
  });

  it('holds the weight and adds a rep inside the range', () => {
    const s = suggestSets(press, [session(last, [60, 8])], { today })!;
    expect(s.reason).toBe('moreReps');
    expect(s.weightKg).toBe(60);
    expect(s.reps).toBe(9);
  });

  it('holds once below the range, and steps down the second time', () => {
    const once = suggestSets(press, [session('2026-02-26', [60, 8]), session(last, [60, 4])], { today })!;
    expect(once.reason).toBe('hold');
    expect(once.weightKg).toBe(60);
    expect(once.reps).toBe(6);
    const twice = suggestSets(press, [session('2026-02-26', [60, 4]), session(last, [60, 4])], { today })!;
    expect(twice.reason).toBe('down');
    expect(twice.weightKg).toBeLessThan(60);
  });

  it('reduces after a break', () => {
    const history = [session('2026-02-01', [97.5, 8]), session('2026-02-05', [100, 8])];
    const short = suggestSets(press, history, { today: '2026-02-20' })!;
    expect(short.reason).toBe('afterBreak');
    expect(short.weightKg).toBe(95);
    const long = suggestSets(press, history, { today: '2026-03-01' })!;
    expect(long.weightKg).toBe(90);
  });

  it('does not treat the usual gap of a rotated exercise as a break', () => {
    const history = dates('2025-12-01', 5, 28).map((date) => session(date, [100, 8]));
    const s = suggestSets(press, history, { today: '2026-04-20' })!;
    expect(s.reason).toBe('moreReps');
    expect(s.weightKg).toBe(100);
  });

  it('never goes up while stalled', () => {
    const status = exerciseStatus(points([100, 100, 100, 100, 100, 100, 100], '2026-01-01', 10), { today: '2026-03-05' });
    expect(status.state).toBe('stalled');
    const s = suggestSets(press, [session(last, [60, 10])], { today, status })!;
    expect(s.reason).toBe('noIncrease');
    expect(s.weightKg).toBe(60);
  });

  it('a maintain goal holds', () => {
    const s = suggestSets(press, [session(last, [60, 12])], { today, setting: { exerciseId: 'press', goal: 'maintain' } })!;
    expect(s.reason).toBe('maintain');
    expect(s.weightKg).toBe(60);
  });

  it('a chosen lighter week takes about 10% off', () => {
    const s = suggestSets(press, [session(last, [100, 8])], { today, lighterWeek: true })!;
    expect(s.reason).toBe('lighterWeek');
    expect(s.weightKg).toBe(90);
  });

  it('keeps the user warm-ups when the top weight is similar', () => {
    const history: Session[] = [
      {
        workoutId: 'a',
        date: last,
        position: 1,
        sets: [
          { kind: 'warmup', weightKg: 20, reps: 15 },
          { kind: 'warmup', weightKg: 40, reps: 10 },
          { kind: 'work', weightKg: 60, reps: 8 },
        ],
      },
    ];
    const s = suggestSets(press, history, { today })!;
    expect(s.sets.filter((x) => x.kind === 'warmup')).toEqual([
      { kind: 'warmup', weightKg: 20, reps: 15 },
      { kind: 'warmup', weightKg: 40, reps: 10 },
    ]);
  });

  it('builds a ramp when the user has no warm-ups that fit', () => {
    const warm = suggestSets(press, [session(last, [100, 8])], { today })!.sets.filter((x) => x.kind === 'warmup');
    expect(warm.map((x) => x.weightKg)).toEqual([40, 60, 80]);
    const step: Session[] = [
      { workoutId: 'a', date: last, position: 1, sets: [{ kind: 'warmup', weightKg: 20, reps: 15 }, { kind: 'work', weightKg: 40, reps: 12 }] },
    ];
    const jumped = suggestSets(press, step, { today, setting: { exerciseId: 'press', stepKg: 10 } })!;
    expect(jumped.weightKg).toBe(50);
    expect(jumped.sets[0].weightKg).toBe(20);
    expect(jumped.sets.filter((x) => x.kind === 'warmup').map((x) => x.weightKg)).toEqual([20, 30, 40]);
  });

  it('adds no ramp to isolation work without warm-ups', () => {
    const s = suggestSets(raise, [session(last, [10, 10])], { today })!;
    expect(s.sets.every((x) => x.kind === 'work')).toBe(true);
  });

  it('keeps back-off sets at their share of the top weight', () => {
    const sets = (top: number, reps: number): [number, number][] => [[top, reps], [top - 10, 8], [top - 10, 7]];
    const history = [session('2026-02-20', ...sets(75, 8)), session('2026-02-26', ...sets(77.5, 8)), session(last, ...sets(80, 10))];
    const s = suggestSets(press, history, { today })!;
    const work = s.sets.filter((x) => x.kind === 'work');
    expect(work.map((x) => x.weightKg)).toEqual([82.5, 72.5, 72.5]);
    expect(work.map((x) => x.reps)).toEqual([6, 8, 7]);
  });

  it('adds time to timed exercises', () => {
    const history: Session[] = [{ workoutId: 'a', date: last, position: 1, sets: [{ kind: 'work', weightKg: 0, reps: 0, seconds: 60 }] }];
    const s = suggestSets(plank, history, { today })!;
    expect(s.reason).toBe('moreTime');
    expect(s.seconds).toBe(65);
    expect(s.sets[0].seconds).toBe(65);
  });

  it('adds reps to unweighted bodyweight work rather than weight', () => {
    const s = suggestSets(pullUp, [session(last, [0, 12])], { today })!;
    expect(s.reason).toBe('moreReps');
    expect(s.weightKg).toBe(0);
    expect(s.reps).toBe(13);
  });
});

describe('next workout', () => {
  const ex = (id: string, muscle: Exercise['muscle']): Exercise => ({ ...press, id, muscle });
  const exercises = new Map(
    [ex('a1', 'chest'), ex('a2', 'chest'), ex('a3', 'chest'), ex('a4', 'triceps'), ex('a5', 'triceps'), ex('a6', 'abs'), ex('a7', 'abs'), ex('b1', 'back'), ex('b2', 'back'), ex('c1', 'legs')].map(
      (e) => [e.id, e],
    ),
  );
  const workout = (date: string, exerciseIds: string[], workSets: Record<string, number> = {}): RotationWorkout => ({ id: date, date, exerciseIds, workSets });

  it('returns null with no history', () => {
    expect(planNextType([], exercises)).toBeNull();
  });

  it('groups workouts by the muscle group they trained most', () => {
    const list = [workout('2026-01-01', ['b1', 'b2', 'c1']), workout('2026-01-02', ['a1', 'a2', 'a4']), workout('2026-01-03', ['gone'])];
    expect(rotationKeys(list, exercises)).toEqual(['back', 'chest', '']);
  });

  it('counts work sets, not exercises', () => {
    expect(rotationKeys([workout('2026-01-01', ['b1', 'b2', 'c1'], { b1: 2, b2: 2, c1: 9 })], exercises)).toEqual(['legs']);
  });

  it('goes round a chest, back and legs split', () => {
    const list = ['a1', 'b1', 'c1', 'a1', 'b1', 'c1', 'a1'].map((id, i) => workout(`2026-01-0${i + 1}`, [id]));
    expect(planNextType(list, exercises)?.key).toBe('back');
  });

  it('follows the rotation', () => {
    expect(nextKey(['a', 'b', 'c', 'a', 'b', 'c', 'a'])).toBe('b');
  });

  it('breaks ties with the type left longest', () => {
    expect(nextKey(['x', 'y', 'z'])).toBe('x');
  });

  it('ignores one-offs in the rotation', () => {
    expect(nextKey(['a', 'b', 'a', 'b', 'a', 'once', 'a'])).toBe('b');
  });

  it('keeps main lifts and rotates the rest', () => {
    const list = [
      workout('2026-01-01', ['a1', 'a2', 'a3', 'a5', 'a7']),
      workout('2026-01-02', ['b1', 'b2']),
      workout('2026-01-03', ['a1', 'a2', 'a3', 'a4', 'a6']),
      workout('2026-01-04', ['b1', 'b2']),
    ];
    const plan = planNextType(list, exercises)!;
    expect(plan.key).toBe('chest');
    expect(plan.exerciseIds.slice(0, 3)).toEqual(['a1', 'a2', 'a3']);
    expect(plan.exerciseIds.slice(3)).toEqual(['a5', 'a7']);
  });

  it('works for someone with a single workout', () => {
    const plan = planNextType([workout('2026-01-01', ['a1', 'a2'])], exercises)!;
    expect(plan.exerciseIds).toEqual(['a1', 'a2']);
  });

  it('skips exercises that no longer exist', () => {
    const plan = planNextType([workout('2026-01-01', ['gone', 'a1'])], exercises)!;
    expect(plan.exerciseIds).toEqual(['a1']);
  });
});

describe('plateaus', () => {
  const record = (action: StallRecord['action'], date: string, helped?: boolean): StallRecord => ({
    id: action + date,
    exerciseId: 'x',
    action,
    date,
    helped,
  });

  it('keeps a lighter week low by default', () => {
    const options = plateauOptions(points([100, 100, 100], '2026-01-01', 3), []);
    expect(options[0]).toBe('repRange');
    expect(options.indexOf('lighterWeek')).toBeGreaterThan(options.indexOf('swap'));
  });

  it('puts training more often first for rarely trained exercises', () => {
    expect(plateauOptions(points([100, 100, 100], '2026-01-01', 21), [])[0]).toBe('frequency');
  });

  it('ranks what helped this user first and what failed last', () => {
    const options = plateauOptions(points([100, 100, 100], '2026-01-01', 3), [
      record('lighterWeek', '2025-01-01', true),
      record('repRange', '2025-02-01', false),
    ]);
    expect(options[0]).toBe('lighterWeek');
    expect(options[options.length - 1]).toBe('repRange');
  });

  it('works out whether a choice helped', () => {
    const p = points([100, 100, 100, 104], '2026-01-01', 7);
    expect(stallOutcome(record('swap', '2026-01-08'), p, '2026-02-01')).toBe(true);
  });

  it('leaves the outcome open until there is enough to say', () => {
    const p = points([100, 100, 100], '2026-01-01', 7);
    expect(stallOutcome(record('swap', '2026-01-08'), p, '2026-02-01')).toBeUndefined();
  });

  it('calls it not helped after long enough', () => {
    const p = points([100, 100, 100], '2026-01-01', 7);
    expect(stallOutcome(record('swap', '2026-01-08'), p, '2026-06-01')).toBe(false);
  });

  it('only returns records that changed', () => {
    const p = points([100, 100, 100, 104], '2026-01-01', 7);
    const changed = resolveOutcomes([record('swap', '2026-01-08'), record('frequency', '2026-01-08', false)], p, '2026-02-01');
    expect(changed).toHaveLength(1);
    expect(changed[0].helped).toBe(true);
  });

  it('offers a clearly different rep range', () => {
    expect(alternateRange({ low: 6, high: 10 })).toEqual({ low: 10, high: 14 });
    expect(alternateRange({ low: 10, high: 14 })).toEqual({ low: 5, high: 8 });
  });
});

describe('summaries', () => {
  it('finds records', () => {
    const r = exerciseRecords([session('2026-01-01', [100, 3]), session('2026-01-08', [90, 10], [100, 5])], 'weight', 75);
    expect(r.heaviest?.reps).toBe(5);
    expect(r.heaviestDate).toBe('2026-01-08');
    expect(r.bestEstimateDate).toBe('2026-01-08');
    expect(r.mostReps).toBe(10);
  });

  it('lists new bests newest first, skipping the first session', () => {
    const bests = newBests([session('2026-01-01', [100, 5]), session('2026-01-08', [105, 5]), session('2026-01-15', [100, 5]), session('2026-01-22', [110, 5])], 'weight', 75);
    expect(bests.map((b) => b.date)).toEqual(['2026-01-22', '2026-01-08']);
  });

  it('starts weeks on Monday', () => {
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // a Sunday
    expect(weekStart('2026-10-26')).toBe('2026-10-26');
  });

  it('includes empty weeks', () => {
    const weeks = weeklyVolume([{ date: '2026-10-28', workSets: 12 }, { date: '2026-10-29', workSets: 8 }], '2026-11-03', 3);
    expect(weeks.map((w) => w.sets)).toEqual([0, 20, 0]);
  });

  it('lays the calendar out in Monday-first weeks', () => {
    const weeks = calendarWeeks(new Set(['2026-10-28']), '2026-10-29', 2);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toHaveLength(7);
    expect(weeks[1][0].date).toBe('2026-10-26');
    expect(weeks[1][2].trained).toBe(true);
    expect(weeks[1][6].future).toBe(true);
  });
});

describe('exercise order', () => {
  const at = (date: string, position: number, weightKg: number, reps: number): Session => ({ ...session(date, [weightKg, reps]), position });

  it('ranks entries from 1, whatever gaps removed exercises left', () => {
    const ranks = entryRanks([
      { workoutId: 'a', entry: 4 },
      { workoutId: 'a', entry: 0 },
      { workoutId: 'a', entry: 4 },
      { workoutId: 'a', entry: 2 },
    ]);
    expect([...ranks.get('a')!]).toEqual([[0, 1], [2, 2], [4, 3]]);
  });

  it('prices later below 1 and earlier above 1, capped at 10%', () => {
    expect(positionFactor(3, 1, 0.025)).toBeCloseTo(0.95);
    expect(positionFactor(1, 3, 0.025)).toBeCloseTo(1.05);
    expect(positionFactor(2, 2, 0.025)).toBe(1);
    expect(positionFactor(9, 1, 0.05)).toBeCloseTo(0.9);
    expect(positionFactor(1, 9, 0.05)).toBeCloseTo(1.1);
  });

  describe('learning the cost', () => {
    /** A slow upward trend, with the third of every four sessions done `slots` later and weaker. */
    function exercise(cost: number, count: number, slots = 2): StrengthPoint[] {
      return dates('2026-01-01', count, 5).map((date, i) => {
        const later = i % 4 === 2;
        const trend = 100 + i * 0.5;
        return { date, position: later ? 1 + slots : 1, value: later ? trend * (1 - cost * slots) : trend };
      });
    }

    it('uses the default with too few comparisons', () => {
      expect(learnPositionCost([exercise(0.04, 8)])).toBe(DEFAULT_POSITION_COST);
      expect(learnPositionCost([])).toBe(DEFAULT_POSITION_COST);
    });

    it('finds a cost from the history, with the trend taken out', () => {
      const cost = learnPositionCost(Array.from({ length: 6 }, () => exercise(0.03, 40)));
      expect(cost).toBeGreaterThan(0.02);
      expect(cost).toBeLessThan(0.04);
    });

    it('stays between 0 and 5%', () => {
      expect(learnPositionCost(Array.from({ length: 6 }, () => exercise(-0.03, 40)))).toBe(0);
      expect(learnPositionCost(Array.from({ length: 6 }, () => exercise(0.07, 40)))).toBe(0.05);
    });
  });

  describe('comparing sets', () => {
    const work = (weightKg: number, reps: number, seconds?: number) => ({ kind: 'work' as const, weightKg, reps, seconds });
    const warm = (weightKg: number, reps: number) => ({ kind: 'warmup' as const, weightKg, reps });

    it('pairs warm-ups and work sets separately, by order', () => {
      const previous = [warm(20, 12), work(60, 8), work(55, 10)];
      const pairs = pairSets([warm(20, 10), warm(40, 5), work(62.5, 6), work(55, 9), work(50, 12)], previous);
      expect(pairs).toEqual([previous[0], undefined, previous[1], previous[2], undefined]);
    });

    it('at different weights goes by estimated strength, within a band', () => {
      expect(compareSet(work(62.5, 9), work(60, 11))).toMatchObject({ trend: 'same', deltaKg: 2.5, deltaReps: -2 });
      expect(compareSet(work(62.5, 6), work(60, 11))).toMatchObject({ trend: 'down', deltaKg: 2.5, deltaReps: -5 });
      expect(compareSet(work(62.5, 11), work(60, 11))?.trend).toBe('up');
      expect(compareSet(work(57.5, 12), work(60, 8))?.trend).toBe('up');
    });

    it('falls back on the weight when strength can not be estimated', () => {
      expect(compareSet(work(10, 8), work(0, 12))?.trend).toBe('up');
      expect(compareSet(work(0, 0, 70), work(5, 0, 70))?.trend).toBe('down');
    });

    it('at equal weight goes by reps or seconds', () => {
      expect(compareSet(work(60, 9), work(60, 8))?.trend).toBe('up');
      expect(compareSet(work(60, 7), work(60, 8))?.trend).toBe('down');
      expect(compareSet(work(60, 8), work(60, 8))?.trend).toBe('same');
      expect(compareSet(work(0, 0, 70), work(0, 0, 60))).toMatchObject({ trend: 'up', deltaSeconds: 10 });
    });

    it('has nothing to say without a previous set or before any reps', () => {
      expect(compareSet(work(60, 8), undefined)).toBeNull();
      expect(compareSet(work(60, 0), work(60, 8))).toBeNull();
    });

    it('keeps tiny weight differences free of float noise', () => {
      expect(compareSet(work(35.5, 8), work(34.875, 8))?.deltaKg).toBe(0.625);
    });

    const options = { position: 1, previousPosition: 1, cost: 0.025, load: 'weight' as const, bodyKg: 75 };

    it('reads a small change as the same', () => {
      expect(compareExercise([work(60, 8)], [work(60, 8)], options)).toMatchObject({ trend: 'same', percent: 0 });
      expect(compareExercise([work(100, 8)], [work(100, 9)], { ...options, cost: 0 })?.trend).toBe('down');
      expect(compareExercise([work(100, 10)], [work(100, 10)], options)?.trend).toBe('same');
    });

    it('calls a clear change up or down', () => {
      expect(compareExercise([work(62.5, 8)], [work(60, 8)], options)?.trend).toBe('up');
      expect(compareExercise([work(55, 8)], [work(60, 8)], options)?.trend).toBe('down');
    });

    it('calls a drop that order explains expected, and a larger one down', () => {
      const later = { ...options, position: 3 };
      const within = compareExercise([work(60, 7)], [work(60, 8)], later)!;
      expect(within.expectedPercent).toBe(-5);
      expect(within.trend).toBe('expected');
      expect(compareExercise([work(50, 8)], [work(60, 8)], later)?.trend).toBe('down');
    });

    it('never excuses a drop when the exercise moved earlier or has no previous position', () => {
      expect(compareExercise([work(60, 7)], [work(60, 8)], { ...options, position: 1, previousPosition: 3 })?.trend).toBe('down');
      expect(compareExercise([work(60, 7)], [work(60, 8)], { ...options, previousPosition: null })).toMatchObject({
        trend: 'down',
        expectedPercent: 0,
      });
    });

    it('compares like with like while sets are still being done', () => {
      const previous = [work(60, 8), work(50, 12), work(50, 10)];
      const oneDone = compareExercise([work(60, 8)], previous, options)!;
      expect(oneDone.percent).toBe(0);
      expect(compareExercise([work(60, 8), work(50, 12), work(50, 10), work(50, 8)], previous, options)?.percent).toBe(0);
    });

    it('leaves warm-ups out and needs something measured', () => {
      expect(compareExercise([warm(20, 12), work(60, 8)], [warm(40, 12), work(60, 8)], options)?.percent).toBe(0);
      expect(compareExercise([work(60, 0)], [work(60, 8)], options)).toBeNull();
      expect(compareExercise([work(60, 8)], [], options)).toBeNull();
    });
  });

  describe('status', () => {
    const today = '2026-03-10';
    const flat = (position = 1) => dates('2026-01-05', 8, 7).map((date) => ({ date, value: 100, position }));

    it('moves values to the usual position', () => {
      const adjusted = adjustPoints([{ date: 'a', value: 100, position: 1 }, { date: 'b', value: 100, position: 1 }, { date: 'c', value: 95, position: 3 }], 0.025);
      expect(adjusted[2].value).toBeCloseTo(100);
      expect(adjusted[0].value).toBe(100);
    });

    it('leaves points without a position alone', () => {
      const raw = points([100, 101]);
      expect(adjustPoints(raw, 0.025)).toEqual(raw);
    });

    it('does not read later sessions as a drop', () => {
      const p = [...flat(), ...dates('2026-03-02', 3, 2).map((date) => ({ date, value: 88, position: 5 }))];
      expect(exerciseStatus(p, { today }).state).toBe('dropping');
      expect(exerciseStatus(p, { today, positionCost: 0.03 }).state).not.toBe('dropping');
    });

    it('does not read an earlier session as a new best', () => {
      const p = [...dates('2026-01-05', 7, 7).map((date) => ({ date, value: 100, position: 4 })), { date: '2026-03-01', value: 106, position: 1 }];
      const status = exerciseStatus(p, { today, positionCost: 0.025 });
      expect(status.state).toBe('stalled');
      expect(exerciseStatus(p, { today }).state).toBe('progressing');
    });

    it('still sees a real new best at a later position', () => {
      const p = [...flat(), { date: '2026-03-05', value: 103, position: 3 }];
      expect(exerciseStatus(p, { today, positionCost: 0.025 }).state).toBe('progressing');
    });
  });

  describe('suggestions', () => {
    const today = '2026-03-02';

    it('does nothing without a position', () => {
      const s = suggestSets(press, [at('2026-02-20', 3, 50, 8), at('2026-02-27', 1, 60, 8)], { today })!;
      expect(s.params.weightKg).toBe(60);
      expect(s.reason).toBe('moreReps');
    });

    it('builds on the latest session at the same position', () => {
      const history = [at('2026-02-13', 3, 50, 8), at('2026-02-20', 1, 60, 8), at('2026-02-27', 1, 60, 9)];
      const s = suggestSets(press, history, { today, position: 3 })!;
      expect(s.params.weightKg).toBe(50);
      expect(s.weightKg).toBe(50);
    });

    it('uses the latest session when none is close, and judges breaks from it', () => {
      const history = [at('2026-02-20', 1, 60, 8), at('2026-02-27', 1, 60, 8)];
      const s = suggestSets(press, history, { today, position: 4 })!;
      expect(s.params.weightKg).toBe(60);
      expect(s.params.days).toBe(3);
    });

    it('holds the weight and expects fewer reps later than the session it builds on', () => {
      const s = suggestSets(press, [at('2026-02-27', 1, 60, 10)], { today, position: 2 })!;
      expect(s.reason).toBe('laterInWorkout');
      expect(s.weightKg).toBe(60);
      expect(s.reps).toBe(9);
      expect(s.sets.filter((x) => x.kind === 'work').map((x) => x.reps)).toEqual([9]);
    });

    it('takes at most two reps off, however much later', () => {
      const s = suggestSets(press, [at('2026-02-27', 1, 60, 8)], { today, position: 6 })!;
      expect(s.reps).toBe(6);
      expect(s.reason).toBe('laterInWorkout');
    });

    it('takes reps off back-off sets too', () => {
      const history: Session[] = [{ ...session('2026-02-27', [60, 8], [50, 12]), position: 1 }];
      const s = suggestSets(press, history, { today, position: 2 })!;
      expect(s.sets.filter((x) => x.kind === 'work').map((x) => x.reps)).toEqual([7, 11]);
    });

    it('leaves a break, a lighter week and a maintain goal in charge', () => {
      const old = [at('2026-01-20', 1, 60, 8)];
      expect(suggestSets(press, old, { today, position: 2 })!.reason).toBe('afterBreak');
      const recent = [at('2026-02-27', 1, 60, 8)];
      expect(suggestSets(press, recent, { today, position: 2, lighterWeek: true })!.reason).toBe('lighterWeek');
      const setting = { exerciseId: 'press', goal: 'maintain' as const };
      expect(suggestSets(press, recent, { today, position: 2, setting })!.reason).toBe('maintain');
    });

    it('says an earlier slot may help only when the normal rule allows more', () => {
      const up = suggestSets(press, [at('2026-02-27', 3, 60, 10)], { today, position: 2 })!;
      expect(up.reason).toBe('earlierInWorkout');
      expect(up.weightKg).toBeGreaterThan(60);
      const stalled = { state: 'stalled', best: 0, bestDate: null, sessionsSinceBest: 5, weeksSinceBest: 8, daysSinceLast: 3, maybeMachineChange: false } as const;
      const held = suggestSets(press, [at('2026-02-27', 3, 60, 8)], { today, position: 2, status: stalled })!;
      expect(held.reason).toBe('noIncrease');
      expect(held.weightKg).toBe(60);
    });

    it('does not ask for more time later in a workout', () => {
      const history: Session[] = [{ workoutId: 'a', date: '2026-02-27', position: 1, sets: [{ kind: 'work', weightKg: 0, reps: 0, seconds: 60 }] }];
      const later = suggestSets(plank, history, { today, position: 3 })!;
      expect(later.reason).toBe('laterInWorkout');
      expect(later.seconds).toBe(60);
      expect(suggestSets(plank, history, { today, position: 1 })!.seconds).toBe(65);
    });
  });
});

describe('sets to failure', () => {
  const today = '2026-03-02';
  const last = '2026-02-27';
  const work = (weightKg: number, reps: number) => ({ kind: 'work' as const, weightKg, reps });
  const options = { position: 1, previousPosition: 1, cost: 0.025, load: 'weight' as const, bodyKg: 75 };

  it('judges a session by its first set at the heaviest weight', () => {
    const falling = session(last, [60, 10], [60, 8], [60, 6]);
    expect(leadSet(falling)).toEqual(work(60, 10));
    const climbing = session(last, [50, 12], [60, 8], [60, 6]);
    expect(leadSet(climbing)).toEqual(work(60, 8));
  });

  it('decides an increase from the first set alone', () => {
    const s = suggestSets(press, [session(last, [60, 10], [60, 8], [60, 6])], { today })!;
    expect(s.reason).toBe('up');
    expect(s.weightKg).toBeGreaterThan(60);
  });

  it('does not lower the weight for a later set below the range', () => {
    const history = [session('2026-02-20', [60, 8], [60, 5], [60, 4]), session(last, [60, 8], [60, 5], [60, 4])];
    const s = suggestSets(press, history, { today })!;
    expect(s.weightKg).toBe(60);
    expect(s.reason).toBe('moreReps');
  });

  it('expects each set to do what the same set did last time', () => {
    const s = suggestSets(press, [session(last, [60, 8], [60, 7], [60, 6])], { today })!;
    expect(s.sets.filter((x) => x.kind === 'work').map((x) => x.reps)).toEqual([9, 7, 6]);
  });

  it('never expects a later set at full weight to beat the first', () => {
    const s = suggestSets(press, [session(last, [60, 10], [60, 9], [60, 8])], { today })!;
    const work = s.sets.filter((x) => x.kind === 'work');
    expect(work[0].weightKg).toBeGreaterThan(60);
    for (const set of work.slice(1)) expect(set.reps).toBeLessThanOrEqual(work[0].reps);
  });

  it('plans the usual number of work sets', () => {
    const four = (date: string) => session(date, [60, 8], [60, 7], [60, 6], [60, 5]);
    expect(usualWorkSets([])).toBe(3);
    expect(usualWorkSets([four('2026-02-13'), four('2026-02-20'), session(last, [60, 8])])).toBe(4);
    const s = suggestSets(press, [four('2026-02-13'), four('2026-02-20'), session(last, [60, 8], [60, 7])], { today })!;
    expect(s.sets.filter((x) => x.kind === 'work')).toHaveLength(4);
  });

  it('keeps the warm-ups the user did', () => {
    const history: Session[] = [
      { workoutId: 'a', date: last, position: 1, sets: [{ kind: 'warmup', weightKg: 20, reps: 12 }, work(60, 8), work(60, 7), work(60, 6)] },
    ];
    const s = suggestSets(press, history, { today })!;
    expect(s.sets.map((x) => x.kind)).toEqual(['warmup', 'work', 'work', 'work']);
  });

  it('counts one more rep across the sets as progress', () => {
    const before = [work(60, 8), work(60, 7), work(60, 6)];
    const now = [work(60, 8), work(60, 7), work(60, 7)];
    const result = compareExercise(now, before, options)!;
    expect(result.percent).toBeLessThan(1);
    expect(result.trend).toBe('up');
  });

  it('does not compare sets with each other: falling reps within a session are fine', () => {
    const same = [work(60, 10), work(60, 7), work(60, 5)];
    expect(compareExercise(same, same, options)?.trend).toBe('same');
    expect(compareSet(work(60, 5), work(60, 5))?.trend).toBe('same');
  });

  it('reads status from the best set, not an average pulled down by later ones', () => {
    const sessions = [session('2026-01-05', [100, 8], [100, 3]), session('2026-01-12', [100, 8], [100, 2])];
    const flat = strengthPoints(sessions, 'weight', 75).map((p) => p.value);
    expect(flat[0]).toBeCloseTo(flat[1]);
    expect(flat[0]).toBeCloseTo(100 * (1 + 8 / 30));
  });
});

describe('weekly frequency', () => {
  const workout = (id: string, date: string, muscle: Exercise['muscle']): RotationWorkout => ({ id, date, exerciseIds: [muscle], workSets: {} });
  const known = new Map((['chest', 'back', 'legs'] as const).map((muscle) => [muscle as string, { ...press, id: muscle, muscle }]));

  it('uses the setting when there is one', () => {
    expect(weeklyFrequency(['2026-01-05'], 2)).toBe(2);
    expect(weeklyFrequency([], 7)).toBe(7);
  });

  it('falls back to 3 with no history', () => {
    expect(weeklyFrequency([], 0)).toBe(3);
    expect(weeklyFrequency([], undefined)).toBe(3);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('reads %i a week from history', (perWeek) => {
    const dates = Array.from({ length: 10 }, (_, week) =>
      Array.from({ length: perWeek }, (_, day) => {
        const d = new Date(2026, 0, 5 + week * 7 + day, 12);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }),
    ).flat();
    expect(weeklyFrequency(dates, 0)).toBe(perWeek);
  });

  it('ignores weeks with no workouts and looks at the latest eight', () => {
    const quiet = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'];
    const recent = dates('2026-01-05', 8, 7).flatMap((monday) => [monday, monday]);
    expect(weeklyFrequency([...quiet, ...recent], 0)).toBe(2);
  });

  it('works out how long a rotation takes', () => {
    expect(expectedGapDays(2, 3)).toBeCloseTo(10.5);
    expect(expectedGapDays(7, 1)).toBe(1);
    expect(expectedGapDays(3, 0)).toBeCloseTo(7 / 3);
  });

  describe('this week', () => {
    it('counts from Monday', () => {
      const week = weekProgress(['2026-03-01', '2026-03-02', '2026-03-03'], '2026-03-04', 3);
      expect(week).toMatchObject({ done: 2, total: 3 });
    });

    it('is not behind early in the week', () => {
      expect(weekProgress([], '2026-03-02', 3).behind).toBe(false);
      expect(weekProgress([], '2026-03-03', 2).behind).toBe(false);
    });

    it('notes a quiet week, and never one already complete', () => {
      expect(weekProgress([], '2026-03-05', 3).behind).toBe(true);
      expect(weekProgress(['2026-03-02', '2026-03-03', '2026-03-04'], '2026-03-08', 3).behind).toBe(false);
      expect(weekProgress(['2026-03-02'], '2026-03-08', 1).behind).toBe(false);
    });

    it.each([1, 2, 3, 4, 5, 6, 7])('never reads a fresh Monday as behind at %i a week', (perWeek) => {
      expect(weekProgress([], '2026-03-02', perWeek).behind).toBe(false);
    });
  });

  describe('rotation', () => {
    /** After "b" the usual next is "a", while "c" has waited longer. */
    const uneven = ['c', 'a', 'b', 'a', 'b', 'a', 'b', 'c', 'a', 'b'];
    const unevenDays = dates('2026-02-01', 10, 3);

    it('counts only types that repeat', () => {
      const list = [workout('1', '2026-01-01', 'chest'), workout('2', '2026-01-03', 'back'), workout('3', '2026-01-05', 'chest'), workout('4', '2026-01-07', 'back'), workout('5', '2026-01-09', 'legs')];
      expect(rotationTypeCount(list, known)).toBe(2);
    });

    it('keeps the normal order when nothing is overdue', () => {
      const keys = ['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b'];
      const days = dates('2026-02-01', 8, 3);
      expect(overdueKey(keys, days, { today: '2026-02-25', perWeek: 3 })).toBe('c');
    });

    it('picks the type left too long', () => {
      expect(nextKey(uneven)).toBe('a');
      expect(overdueKey(uneven, unevenDays, { today: '2026-03-03', perWeek: 3 })).toBe('c');
    });

    it('does not call the rotation late at a low frequency', () => {
      expect(overdueKey(uneven, unevenDays, { today: '2026-03-03', perWeek: 1 })).toBe('a');
    });

    it('plans the overdue type', () => {
      const muscles = { a: 'chest', b: 'back', c: 'legs' } as const;
      const list = unevenDays.map((date, i) => workout(String(i), date, muscles[uneven[i] as keyof typeof muscles]));
      expect(planNextType(list, known, { today: '2026-03-03', perWeek: 3 })?.key).toBe('legs');
      expect(planNextType(list, known)?.key).toBe('chest');
    });
  });

  it('does not call a normal wait a break at a low frequency', () => {
    // Twice a week over four types: a rotation takes two weeks, so 25 days is under two of them.
    const p = points([100, 100, 100], '2026-01-01', 10);
    const today = '2026-02-15';
    expect(exerciseStatus(p, { today }).state).toBe('returning');
    expect(exerciseStatus(p, { today, expectedGapDays: expectedGapDays(2, 4) }).state).not.toBe('returning');
  });

  it('does not lighten a suggestion for a normal wait', () => {
    const history = [session('2026-02-01', [60, 8])];
    const today = '2026-02-16';
    expect(suggestSets(press, history, { today })!.reason).toBe('afterBreak');
    expect(suggestSets(press, history, { today, expectedGapDays: expectedGapDays(2, 3) })!.reason).toBe('moreReps');
  });

  it('ranks training more often last-but-one when the rotation allows no more', () => {
    const p = points([100, 100, 100, 100], '2026-01-01', 10);
    expect(atRotationLimit(p, expectedGapDays(2, 3))).toBe(true);
    const options = plateauOptions(p, [], expectedGapDays(2, 3));
    expect(options.indexOf('frequency')).toBe(options.indexOf('maintain') - 1);
  });

  it('keeps training more often first when there is room', () => {
    const p = points([100, 100, 100, 100], '2026-01-01', 21);
    expect(atRotationLimit(p, expectedGapDays(3, 3))).toBe(false);
    expect(plateauOptions(p, [], expectedGapDays(3, 3))[0]).toBe('frequency');
  });
});

describe('off days', () => {
  const off = (p: StrengthPoint): StrengthPoint => ({ ...p, offDay: true });
  const today = '2026-03-10';

  it('leaves an off day out of the comparison, unless it set a new best', () => {
    const list = [{ date: 'a', value: 100 }, off({ date: 'b', value: 80 }), off({ date: 'c', value: 110 }), { date: 'd', value: 105 }];
    expect(countedPoints(list).map((p) => p.date)).toEqual(['a', 'c', 'd']);
  });

  it('never turns an exercise stalled', () => {
    const flat = points([100, 100, 100, 100, 100, 100, 100, 100], '2026-01-05', 7);
    expect(exerciseStatus(flat, { today }).state).toBe('stalled');
    const excused = flat.map((p, i) => (i > 1 ? off(p) : p));
    expect(exerciseStatus(excused, { today }).state).not.toBe('stalled');
  });

  it('never turns an exercise dropping', () => {
    const fell = points([100, 100, 100, 92, 90, 89, 88], '2026-01-05', 7);
    const soon = '2026-02-20';
    expect(exerciseStatus(fell, { today: soon, ignoreFall: true }).state).toBe('dropping');
    const excused = fell.map((p) => (p.value < 100 ? off(p) : p));
    expect(exerciseStatus(excused, { today: soon, ignoreFall: true }).state).not.toBe('dropping');
  });

  it('still counts a new best on an off day', () => {
    const list = points([100, 101, 102, 103], '2026-02-01', 7);
    list[3] = off({ ...list[3], value: 120 });
    const status = exerciseStatus(list, { today: '2026-02-25' });
    expect(status.best).toBe(120);
    expect(status.state).toBe('progressing');
  });

  it('counts an off day as a day in the gym for breaks', () => {
    const list = [...points([100, 100, 100, 100], '2026-01-05', 7), off({ date: '2026-03-08', value: 90 })];
    expect(exerciseStatus(list, { today }).daysSinceLast).toBe(2);
  });

  it('keeps off days out of the sessions a suggestion builds on', () => {
    const bad = { ...session('2026-03-01', [80, 3], [80, 3]), offDay: true };
    const good = session('2026-02-20', [80, 8], [80, 7]);
    expect(countedSessions([good, bad], 'weight', 75)).toEqual([good]);
    const best = { ...session('2026-03-01', [90, 8]), offDay: true };
    expect(countedSessions([good, best], 'weight', 75)).toEqual([good, best]);
  });

  it('doesn\u2019t push the weight down after an off day', () => {
    const fine = [session('2026-02-10', [80, 7], [80, 6]), session('2026-02-17', [80, 7], [80, 6])];
    const history = [
      ...fine,
      { ...session('2026-02-24', [80, 3], [80, 3]), offDay: true },
      { ...session('2026-03-03', [80, 3], [80, 2]), offDay: true },
    ];
    const suggestion = suggestSets(press, history, { today: '2026-03-07' });
    expect(suggestion?.reason).not.toBe('down');
    expect(suggestion?.weightKg).toBe(80);
    expect(suggestion?.reps).toBe(8);
  });

  it('shows a tagged dip as expected rather than down', () => {
    const before = [{ kind: 'work' as const, weightKg: 80, reps: 8 }];
    const now = [{ kind: 'work' as const, weightKg: 80, reps: 4 }];
    const options = { position: 1, previousPosition: 1, cost: 0.02, load: 'weight' as const, bodyKg: 75 };
    expect(compareExercise(now, before, options)?.trend).toBe('down');
    expect(compareExercise(now, before, { ...options, offDay: true })?.trend).toBe('expected');
  });
});

describe('pain', () => {
  const hurt = (s: Session): Session => ({ ...s, pain: true, offDay: true });

  it('blocks an increase at the next session, with its reason', () => {
    const history = [session('2026-02-10', [80, 10], [80, 9]), hurt(session('2026-02-17', [80, 11], [80, 10]))];
    const suggestion = suggestSets(press, history, { today: '2026-02-20' });
    expect(suggestion?.reason).toBe('pain');
    expect(suggestion?.weightKg).toBe(80);
  });

  it('stops applying once a later session has no pain', () => {
    const history = [hurt(session('2026-02-10', [80, 9], [80, 9])), session('2026-02-17', [80, 11], [80, 10])];
    expect(suggestSets(press, history, { today: '2026-02-20' })?.reason).toBe('up');
  });
});

describe('tags', () => {
  const custom = [
    { id: 'tag-a', label: 'A', offDay: true },
    { id: 'tag-b', label: 'B', offDay: false },
  ];

  it('treats built-in tags and off-day custom tags as off days', () => {
    expect(isOffDay([{ tags: ['tired'] }], [])).toBe(true);
    expect(isOffDay([{ tags: ['tag-a'] }], custom)).toBe(true);
    expect(isOffDay([{ tags: ['tag-b'] }], custom)).toBe(false);
    expect(isOffDay([{ tags: ['tag-gone'] }], custom)).toBe(false);
    expect(hasPain([{ tags: ['pain'] }])).toBe(true);
  });

});

describe('learned rep range', () => {
  const heavy = (date: string) => session(date, [30, 4], [20, 6]);
  const dates = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02', '2026-02-09'];

  it('uses the usual range until there\u2019s a habit', () => {
    expect(repRange(press)).toEqual({ low: 6, high: 10 });
    expect(repRange(press, undefined, dates.slice(0, 2).map(heavy))).toEqual({ low: 6, high: 10 });
  });

  it('follows a habit outside the usual range', () => {
    expect(repRange(press, undefined, dates.map(heavy))).toEqual({ low: 3, high: 6 });
    expect(repRange(press, undefined, dates.map((d) => session(d, [20, 15])))).toEqual({ low: 14, high: 17 });
  });

  it('stays with the usual range when the habit fits it', () => {
    expect(repRange(press, undefined, dates.map((d) => session(d, [60, 8])))).toEqual({ low: 6, high: 10 });
  });

  it('lets the user\u2019s setting win', () => {
    expect(repRange(press, { exerciseId: 'press', repLow: 8, repHigh: 12 }, dates.map(heavy))).toEqual({ low: 8, high: 12 });
  });

  it('doesn\u2019t step down from someone\u2019s normal low reps', () => {
    const suggestion = suggestSets(press, dates.map(heavy), { today: '2026-02-12' });
    expect(suggestion?.reason).not.toBe('down');
    expect(suggestion?.weightKg).toBe(30);
  });
});

describe('partial reps', () => {
  it('compares without rounding them away', () => {
    const work = (reps: number) => ({ kind: 'work' as const, weightKg: 30, reps });
    expect(compareSet(work(7.8), work(7.5))).toMatchObject({ trend: 'up', deltaReps: 0.3 });
    expect(estimateSet(work(7.5), 'weight', 0)).toBeCloseTo(37.5);
  });

  it('aims for the next whole rep', () => {
    const history = [session('2026-02-10', [60, 7.5], [60, 7]), session('2026-02-17', [60, 7.5], [60, 7])];
    expect(suggestSets(press, history, { today: '2026-02-20' })?.reps).toBe(8);
  });
});

describe('failure and held-back sessions', () => {
  const trained = (date: string, weightKg: number, reps: number, failure: boolean): Session => ({
    ...session(date, [weightKg, reps]),
    sets: [{ kind: 'work', weightKg, reps, ...(failure ? { failure: true } : {}) }],
  });
  const habit = [trained('2026-01-05', 60, 8, true), trained('2026-01-12', 60, 9, true), trained('2026-01-19', 60, 9, true)];

  it('treats a session without a failure set as an off day when failure is the habit', () => {
    const marked = markHeldBack([...habit, trained('2026-01-26', 50, 8, false)]);
    expect(marked[3].offDay).toBe(true);
    expect(marked.slice(0, 3).some((s) => s.offDay)).toBe(false);
  });

  it('leaves it alone with too few sessions before it, or no habit', () => {
    expect(markHeldBack([...habit.slice(0, 2), trained('2026-01-26', 50, 8, false)])[2].offDay).toBeUndefined();
    const rarely = [trained('2026-01-05', 60, 8, true), trained('2026-01-12', 60, 9, false), trained('2026-01-19', 60, 9, false)];
    expect(markHeldBack([...rarely, trained('2026-01-26', 50, 8, false)])[3].offDay).toBeUndefined();
  });

  it('only looks at the latest few sessions for the habit', () => {
    const old = dates('2026-01-05', 3, 7).map((d) => trained(d, 60, 8, true));
    const since = dates('2026-02-02', 6, 7).map((d) => trained(d, 60, 8, false));
    expect(markHeldBack([...old, ...since]).at(-1)?.offDay).toBeUndefined();
  });

  it('ignores a failure mark on a warm-up, and a session of warm-ups only', () => {
    const warm: Session = { ...session('2026-01-26'), sets: [{ kind: 'warmup', weightKg: 20, reps: 8 }] };
    expect(markHeldBack([...habit, warm])[3].offDay).toBeUndefined();
    const marked: Session = { ...session('2026-01-26', [50, 8]), sets: [{ kind: 'warmup', weightKg: 20, reps: 8, failure: true }, { kind: 'work', weightKg: 50, reps: 8 }] };
    expect(markHeldBack([...habit, marked])[3].offDay).toBe(true);
  });

  it('keeps a new best set in a held-back session', () => {
    const history = markHeldBack([...habit, trained('2026-01-26', 80, 8, false)]);
    expect(countedSessions(history, 'weight', 0)).toHaveLength(4);
  });

  it('doesn\u2019t build today\u2019s suggestion on a held-back session', () => {
    const history = markHeldBack([...habit, trained('2026-01-26', 40, 8, false)]);
    expect(suggestSets(press, history, { today: '2026-01-29' })?.params.weightKg).toBe(60);
  });
});

describe('levels', () => {
  const levelled = (date: string, level: number | undefined, ...reps: number[]): Session => ({
    ...session(date),
    sets: reps.map((n) => ({ kind: 'work', weightKg: 0, reps: n, ...(level === undefined ? {} : { level }) })),
  });
  const row: Exercise = { ...pullUp, id: 'row', levels: true };

  it('compares sessions at the latest level only, and keeps sessions with none recorded', () => {
    const history = [levelled('2026-01-05', undefined, 10), levelled('2026-01-12', 11, 10), levelled('2026-01-19', 12, 9), levelled('2026-01-26', 12, 10)];
    expect(atLatestLevel(history).map((s) => s.date)).toEqual(['2026-01-05', '2026-01-19', '2026-01-26']);
  });

  it('changes nothing when the latest session has no level', () => {
    const history = [levelled('2026-01-12', 11, 10), levelled('2026-01-19', undefined, 9)];
    expect(atLatestLevel(history)).toEqual(history);
    expect(atLatestLevel([])).toEqual([]);
  });

  it('doesn\u2019t compare sets at different levels', () => {
    const at = (level: number | undefined, reps: number) => ({ kind: 'work' as const, weightKg: 0, reps, ...(level === undefined ? {} : { level }) });
    expect(compareSet(at(12, 10), at(11, 8))).toBeNull();
    expect(compareSet(at(12, 10), at(12, 8))?.trend).toBe('up');
    expect(compareSet(at(12, 10), at(undefined, 8))?.trend).toBe('up');
    const options = { position: 1, previousPosition: 1, cost: 0, load: 'body' as const, bodyKg: 75 };
    expect(compareExercise([at(12, 10)], [at(11, 8)], options)).toBeNull();
    expect(compareExercise([at(12, 10)], [at(12, 8)], options)?.trend).toBe('up');
  });

  it('plans sets at the level they were done at', () => {
    const history = [levelled('2026-01-12', 12, 10, 9, 9), levelled('2026-01-19', 12, 10, 10, 9)];
    const plan = suggestSets(row, history, { today: '2026-01-22', body: 75 });
    expect(plan?.sets.filter((s) => s.kind === 'work').map((s) => s.level)).toEqual([12, 12, 12]);
  });

  it('adds no level to a plan for an exercise without one', () => {
    const plan = suggestSets(press, [session('2026-01-19', [60, 8])], { today: '2026-01-22' });
    expect(plan?.sets.every((s) => !('level' in s))).toBe(true);
  });
});

describe('failed attempts', () => {
  const today = '2026-03-05';
  const last = '2026-03-02';

  it('never lead a session or become its top set', () => {
    const s = session(last, [100, 8], [110, 0]);
    expect(leadSet(s)).toMatchObject({ weightKg: 100, reps: 8 });
    expect(topSet(s)).toMatchObject({ weightKg: 100, reps: 8 });
  });

  it('build the suggestion on what was lifted', () => {
    const s = suggestSets(press, [session(last, [100, 8], [110, 0])], { today })!;
    expect(s.params).toMatchObject({ weightKg: 100, reps: 8 });
    expect(s.weightKg).toBe(100);
    expect(s.reps).toBe(9);
    expect(s.sets.filter((x) => x.kind === 'work').map((x) => x.weightKg)).toEqual([100]);
  });

  it('leave out a session with nothing lifted, and it does not count as the base', () => {
    const s = suggestSets(press, [session('2026-02-26', [100, 8]), session(last, [110, 0])], { today })!;
    expect(s.weightKg).toBe(100);
    expect(s.params.baseDate).toBe('2026-02-26');
  });

  it('give nothing to go on by themselves', () => {
    expect(suggestSets(press, [session(last, [110, 0])], { today })).toBeNull();
  });

  it('still leave a weight of zero usable on a weighted exercise', () => {
    expect(suggestSets(press, [session(last, [0, 8])], { today })?.reps).toBe(9);
  });

  it('are not records', () => {
    const r = exerciseRecords([session(last, [100, 8], [110, 0])], 'weight', 75);
    expect(r.heaviest).toMatchObject({ weightKg: 100, reps: 8 });
  });

  it('are not compared with', () => {
    const work = (weightKg: number, reps: number) => ({ kind: 'work' as const, weightKg, reps });
    expect(compareSet(work(100, 8), work(110, 0))).toBeNull();
  });
});

describe('comparing bodyweight sets', () => {
  const work = (weightKg: number, reps: number, seconds?: number) => ({ kind: 'work' as const, weightKg, reps, seconds });

  it('counts the body in the estimate', () => {
    expect(compareSet(work(5, 10), work(10, 6), { load: 'body', bodyKg: 80 })?.trend).toBe('up');
    expect(compareSet(work(10, 6), work(5, 10), { load: 'body', bodyKg: 80 })?.trend).toBe('down');
  });

  it('falls back on the usual stand-in when no body weight is set', () => {
    expect(compareSet(work(5, 10), work(10, 6), { load: 'body' })?.trend).toBe('up');
    expect(compareSet(work(5, 10), work(10, 6), { load: 'body', bodyKg: 0 })?.trend).toBe('up');
  });

  it('can compare added weight with none', () => {
    expect(compareSet(work(10, 8), work(0, 12), { load: 'body', bodyKg: 75 })).toMatchObject({ trend: 'up', deltaKg: 10 });
    expect(compareSet(work(0, 6), work(10, 8), { load: 'body', bodyKg: 75 })?.trend).toBe('down');
  });

  it('leaves weighted exercises as they were', () => {
    expect(compareSet(work(5, 10), work(10, 6))?.trend).toBe('down');
    expect(compareSet(work(5, 10), work(10, 6), { load: 'weight', bodyKg: 80 })?.trend).toBe('down');
  });

  it('goes by the weight for timed sets', () => {
    expect(compareSet(work(5, 0, 40), work(0, 0, 70), { load: 'time', bodyKg: 80 })?.trend).toBe('up');
  });
});

describe('suggestions after a break and in a lighter week', () => {
  const small: Exercise = { ...raise, equipment: 'dumbbell' };
  const setting = { exerciseId: 'raise', stepKg: 2.5 };
  const last = '2026-02-01';
  const short = '2026-02-17';
  const long = '2026-03-01';

  it('takes reps off when a step is too big for the share', () => {
    const history = [session(last, [20, 10], [20, 9], [20, 8])];
    const s = suggestSets(small, history, { today: short, setting })!;
    expect(s.reason).toBe('afterBreakReps');
    expect(s.weightKg).toBe(20);
    expect(s.reps).toBe(9);
    expect(s.sets.map((x) => x.reps)).toEqual([9, 8, 7]);
  });

  it('calls it lighter only when the weight fell', () => {
    const s = suggestSets(small, [session(last, [20, 10])], { today: long, setting })!;
    expect(s.reason).toBe('afterBreak');
    expect(s.weightKg).toBe(17.5);
    expect(s.reps).toBe(10);
  });

  it('takes reps off bodyweight work', () => {
    const s = suggestSets(pullUp, [session(last, [0, 12])], { today: short })!;
    expect(s.reason).toBe('afterBreakReps');
    expect(s.weightKg).toBe(0);
    expect(s.reps).toBe(11);
  });

  it('takes more off after a long break, in proportion to the reps', () => {
    expect(suggestSets(pullUp, [session(last, [0, 30])], { today: short })!.reps).toBe(28);
    expect(suggestSets(pullUp, [session(last, [0, 30])], { today: long })!.reps).toBe(27);
  });

  it('keeps a little added weight and takes reps off', () => {
    const s = suggestSets(pullUp, [session(last, [5, 8])], { today: short })!;
    expect(s.reason).toBe('afterBreakReps');
    expect(s.weightKg).toBe(5);
    expect(s.reps).toBe(7);
  });

  it('always lands below a partial rep', () => {
    expect(suggestSets(pullUp, [session(last, [0, 7.5])], { today: short })!.reps).toBe(7);
  });

  it('says so when there is nothing to take off', () => {
    const s = suggestSets(pullUp, [session(last, [0, 1])], { today: short })!;
    expect(s.reason).toBe('afterBreakSame');
    expect(s.reps).toBe(1);
  });

  it('makes a lighter week lighter even with a weight too small to step down', () => {
    const s = suggestSets(small, [session('2026-02-27', [10, 10])], { today: '2026-03-02', lighterWeek: true, setting })!;
    expect(s.reason).toBe('lighterWeek');
    expect(s.weightKg).toBe(10);
    expect(s.reps).toBe(9);
    const body = suggestSets(pullUp, [session('2026-02-27', [0, 10])], { today: '2026-03-02', lighterWeek: true })!;
    expect(body.reps).toBe(9);
  });

  describe('on timed exercises', () => {
    const timed = (...seconds: number[]): Session => ({
      workoutId: last,
      date: last,
      position: 1,
      sets: seconds.map((s) => ({ kind: 'work', weightKg: 0, reps: 0, seconds: s })),
    });

    it('asks for less time, not more', () => {
      const s = suggestSets(plank, [timed(60)], { today: '2026-06-01' })!;
      expect(s.reason).toBe('afterBreakTime');
      expect(s.seconds).toBe(55);
    });

    it('takes at least a time step off, and more from a long hold', () => {
      expect(suggestSets(plank, [timed(20)], { today: short })!.seconds).toBe(15);
      expect(suggestSets(plank, [timed(120)], { today: long })!.seconds).toBe(110);
    });

    it('caps the other sets at the target', () => {
      expect(suggestSets(plank, [timed(60, 60, 45)], { today: long })!.sets.map((x) => x.seconds)).toEqual([55, 55, 45]);
    });

    it('says so when a hold is too short to shorten', () => {
      const s = suggestSets(plank, [timed(5)], { today: long })!;
      expect(s.reason).toBe('afterBreakSame');
      expect(s.seconds).toBe(5);
    });

    it('follows a lighter week', () => {
      const s = suggestSets(plank, [timed(60)], { today: '2026-02-03', lighterWeek: true })!;
      expect(s.reason).toBe('lighterWeek');
      expect(s.seconds).toBe(55);
    });

    it('still adds time after a normal wait', () => {
      expect(suggestSets(plank, [timed(60)], { today: '2026-02-04' })!.seconds).toBe(65);
    });
  });
});

describe('the session a suggestion builds on', () => {
  const at = (date: string, position: number, weightKg: number, reps: number): Session => ({ ...session(date, [weightKg, reps]), position });

  it('names the base only when it is not the latest session', () => {
    const today = '2026-03-02';
    const history = [at('2026-02-13', 3, 50, 8), at('2026-02-27', 1, 60, 8)];
    expect(suggestSets(press, history, { today, position: 3 })!.params.baseDate).toBe('2026-02-13');
    expect(suggestSets(press, history, { today, position: 1 })!.params.baseDate).toBeUndefined();
    expect(suggestSets(press, history, { today })!.params.baseDate).toBeUndefined();
  });

  it('names it when the latest session was an off day', () => {
    const history = [session('2026-02-20', [80, 8]), { ...session('2026-02-27', [80, 3]), offDay: true }];
    const s = suggestSets(press, history, { today: '2026-03-02' })!;
    expect(s.weightKg).toBe(80);
    expect(s.params.baseDate).toBe('2026-02-20');
  });
});

describe('a restarted comparison', () => {
  const today = '2026-04-01';
  const baseline = (date: string) => ({ id: date, exerciseId: 'x', date });

  it('is told from a first session by the history before the change', () => {
    const sessions = [{ date: '2026-01-01' }, { date: '2026-03-20' }];
    expect(restartDate(sessions, [baseline('2026-03-01')])).toBe('2026-03-01');
    expect(restartDate(sessions, [])).toBeUndefined();
    expect(restartDate([{ date: '2026-03-20' }], [baseline('2026-03-01')])).toBeUndefined();
  });

  it('does not read as new with nothing since the change', () => {
    const status = exerciseStatus([], { today, restartedOn: '2026-03-30' });
    expect(status.state).toBe('returning');
    expect(status.restartedOn).toBe('2026-03-30');
    expect(status.bestDate).toBeNull();
  });

  it('does not read as new with a session or two since the change', () => {
    const status = exerciseStatus(points([60, 62], '2026-03-25', 3), { today, restartedOn: '2026-03-20' });
    expect(status.state).toBe('returning');
    expect(status.restartedOn).toBe('2026-03-20');
    expect(status.best).toBe(62);
  });

  it('turns into a normal status once there is enough to compare', () => {
    const status = exerciseStatus(points([60, 62, 64, 66], '2026-03-10', 7), { today, restartedOn: '2026-03-01' });
    expect(status.state).toBe('progressing');
    expect(status.restartedOn).toBeUndefined();
  });

  it('keeps sessions before the change out of the comparison', () => {
    const before = [session('2026-01-05', [100, 8]), session('2026-01-12', [100, 8]), session('2026-01-19', [100, 8])];
    const after = [session('2026-03-25', [60, 8])];
    const compared = sinceBaseline([...before, ...after], [baseline('2026-03-20')]);
    const s = suggestSets(press, compared, { today })!;
    expect(s.params.weightKg).toBe(60);
    expect(exerciseStatus(strengthPoints(compared, 'weight', 75), { today }).best).toBeLessThan(80);
  });

  it('suggests nothing until there is a session after the change', () => {
    expect(suggestSets(press, sinceBaseline([session('2026-01-05', [100, 8])], [baseline('2026-03-20')]), { today })).toBeNull();
  });

  it('leaves someone truly new as new', () => {
    expect(exerciseStatus(points([100], '2026-03-30'), { today }).state).toBe('new');
  });
});

describe('levels within and across sessions', () => {
  const set = (level: number | undefined, weightKg: number, reps: number): SessionSet => ({ kind: 'work', weightKg, reps, ...(level === undefined ? {} : { level }) });
  const mixed = (date: string, ...sets: SessionSet[]): Session => ({ workoutId: date, date, position: 1, sets });

  it('takes a session estimate from its lead level', () => {
    const s = mixed('2026-01-05', set(12, 5, 6), set(11, 0, 20));
    expect(sessionStrength(s, 'body', 75)).toBeCloseTo(80 * (1 + 6 / 30));
    expect(topSet(s)).toMatchObject({ level: 12, weightKg: 5 });
  });

  it('keeps sets with no level recorded in the estimate', () => {
    const s = mixed('2026-01-05', set(12, 5, 6), set(undefined, 0, 20));
    expect(sessionStrength(s, 'body', 75)).toBeCloseTo(75 * (1 + 20 / 30));
  });

  it('keeps records and new bests at the lead level too', () => {
    const s = mixed('2026-01-05', set(12, 5, 6), set(11, 0, 20));
    expect(exerciseRecords([s], 'body', 75).mostReps).toBe(6);
    const bests = newBests([mixed('2026-01-01', set(12, 5, 8)), s], 'body', 75);
    expect(bests).toEqual([]);
  });

  it('uses the latest recorded level when the latest session has none', () => {
    const history = [mixed('2026-01-05', set(11, 0, 10)), mixed('2026-01-12', set(12, 0, 9)), mixed('2026-01-19', set(undefined, 0, 9))];
    expect(atLatestLevel(history).map((s) => s.date)).toEqual(['2026-01-12', '2026-01-19']);
  });
});

describe('warm-up-only sessions', () => {
  const warm: Session = { workoutId: 'w', date: '2026-03-02', position: 1, sets: [{ kind: 'warmup', weightKg: 100, reps: 15 }] };
  const today = '2026-03-05';

  it('have no estimate, lead or top set', () => {
    expect(sessionStrength(warm, 'weight', 75)).toBeNull();
    expect(leadSet(warm)).toBeNull();
    expect(topSet(warm)).toBeNull();
    expect(strengthPoints([warm], 'weight', 75)).toEqual([]);
  });

  it('are not records or a new best', () => {
    const before = session('2026-02-20', [60, 8]);
    expect(exerciseRecords([before, warm], 'weight', 75).heaviest?.weightKg).toBe(60);
    expect(newBests([before, warm], 'weight', 75)).toEqual([]);
  });

  it('give a suggestion nothing to build on and do not lower the usual sets', () => {
    expect(suggestSets(press, [warm], { today })).toBeNull();
    const before = session('2026-02-20', [60, 8], [60, 7], [60, 6]);
    expect(suggestSets(press, [before, warm], { today })?.params.weightKg).toBe(60);
    expect(usualWorkSets([before, warm])).toBe(3);
  });

  it('are not compared as work', () => {
    const warmups = warm.sets;
    const options = { position: 1, previousPosition: 1, cost: 0, load: 'weight' as const, bodyKg: 75 };
    expect(compareExercise(warmups, [{ kind: 'work', weightKg: 60, reps: 8 }], options)).toBeNull();
    expect(compareExercise([{ kind: 'work', weightKg: 60, reps: 8 }], warmups, options)).toBeNull();
  });
});

describe('the rep cap on bodyweight exercises', () => {
  const set = (weightKg: number, reps: number) => ({ kind: 'work' as const, weightKg, reps });

  it.each([16, 20, 30, 40])('scores added weight above none at %i reps', (reps) => {
    expect(estimateSet(set(5, reps), 'body', 75)).toBeGreaterThan(estimateSet(set(0, reps), 'body', 75));
  });
});

describe('ramp-up sets stored as work', () => {
  const body = 80;
  const set = (weightKg: number, reps: number, extra: Partial<SessionSet> = {}): SessionSet => ({ kind: 'work', weightKg, reps, ...extra });
  const warm = (weightKg: number, reps: number): SessionSet => ({ kind: 'warmup', weightKg, reps });
  const kinds = (sets: SessionSet[], load: Exercise['load'] = 'weight') => effectiveSets(sets, load, body).map((s) => s.kind);
  const ramped = (date = '2031-02-01'): Session => ({
    workoutId: date,
    date,
    position: 1,
    sets: effectiveSets([set(40, 3), set(70, 5), set(67.5, 5), set(65, 6)], 'weight', body),
  });

  it('pairs today’s first work set with last time’s first real one', () => {
    const today = [set(70, 6), set(67.5, 6), set(65, 7)];
    const pairs = pairSets(today, ramped().sets);
    expect(pairs.map((s) => [s?.weightKg, s?.reps])).toEqual([
      [70, 5],
      [67.5, 5],
      [65, 6],
    ]);
    expect(compareSet(today[0], pairs[0])).toMatchObject({ deltaKg: 0, deltaReps: 1, trend: 'up' });
  });

  it('compares the exercise without the ramp-up set', () => {
    const today = [set(70, 5), set(67.5, 5), set(65, 6)];
    const result = compareExercise(today, ramped().sets, { position: 1, previousPosition: 1, cost: 0, load: 'weight', bodyKg: body });
    expect(result).toMatchObject({ percent: 0, trend: 'same' });
  });

  it('leaves it out of the work sets and the number of planned sets', () => {
    const history = [ramped('2031-02-01'), ramped('2031-02-08'), ramped('2031-02-15')];
    expect(doneWork(history[0]).map((s) => s.weightKg)).toEqual([70, 67.5, 65]);
    expect(usualWorkSets(history)).toBe(3);
    const plan = suggestSets(press, history, { today: '2031-02-22' });
    expect(plan?.sets.filter((s) => s.kind === 'work')).toHaveLength(3);
    expect(plan?.sets[0]).toMatchObject({ kind: 'warmup', weightKg: 40, reps: 3 });
  });

  it('keeps an ascending pyramid as work', () => {
    expect(kinds([set(55, 10), set(65, 8), set(75, 6)])).toEqual(['work', 'work', 'work']);
  });

  it('keeps a long pyramid whose first set is far below the best: reps fell at every step', () => {
    const sets = [set(60, 12), set(70, 10), set(80, 8), set(90, 6)];
    expect(estimateSet(sets[0], 'weight', body)).toBeLessThan(0.8 * estimateSet(sets[3], 'weight', body));
    expect(kinds(sets)).toEqual(['work', 'work', 'work', 'work']);
  });

  it('keeps a light high-rep set when nothing proves it was easy', () => {
    expect(kinds([set(30, 12), set(60, 6), set(60, 5)])).toEqual(['work', 'work', 'work']);
  });

  it('keeps straight sets before a heavier single', () => {
    expect(kinds([set(60, 6), set(60, 6), set(80, 1)])).toEqual(['work', 'work', 'work']);
  });

  it('keeps a slightly lighter set before the top weight', () => {
    expect(kinds([set(65, 6), set(70, 6), set(70, 5)])).toEqual(['work', 'work', 'work']);
  });

  it('reads every step of a longer ramp, and keeps the set that only came close', () => {
    expect(kinds([set(30, 4), set(45, 4), set(65, 4), set(70, 5), set(70, 5)])).toEqual(['warmup', 'warmup', 'work', 'work', 'work']);
  });

  it('ignores a failure mark that later sets disprove, and drops it', () => {
    const [ramp, top] = effectiveSets([set(40, 3, { failure: true }), set(70, 5, { failure: true })], 'weight', body);
    expect(ramp).toMatchObject({ kind: 'warmup', weightKg: 40, reps: 3 });
    expect(ramp.failure).toBeUndefined();
    expect(top).toMatchObject({ kind: 'work', failure: true });
  });

  it('doesn’t let a ramp-up set’s failure mark count, or reach the plan', () => {
    const at = (date: string, ...sets: SessionSet[]): Session => ({ workoutId: date, date, position: 1, sets: effectiveSets(sets, 'weight', body) });
    const history = dates('2031-02-01', 5, 7).map((date) => at(date, set(40, 3, { failure: true }), set(70, 5), set(70, 5)));
    expect(markHeldBack(history).some((s) => s.offDay)).toBe(false);
    const plan = suggestSets(press, history, { today: '2031-03-08' });
    expect(plan?.sets.some((s) => s.failure)).toBe(false);
  });

  it('keeps a real failure mark for the set that carries it into the plan', () => {
    const last = { ...ramped(), sets: effectiveSets([set(40, 3), set(70, 5, { failure: true }), set(65, 6, { failure: true })], 'weight', body) };
    const plan = suggestSets(press, [last], { today: '2031-02-05' });
    expect(plan?.sets.filter((s) => s.kind === 'work').every((s) => s.failure)).toBe(true);
    expect(plan?.sets.filter((s) => s.kind === 'warmup').some((s) => s.failure)).toBe(false);
  });

  it('never touches back-off or descending sets', () => {
    expect(kinds([set(70, 5), set(70, 4), set(40, 12), set(30, 15)])).toEqual(['work', 'work', 'work', 'work']);
    expect(kinds([set(80, 4), set(60, 8), set(40, 12)])).toEqual(['work', 'work', 'work']);
  });

  it('keeps sets after the ramp-up and the first top set as they are', () => {
    expect(kinds([set(40, 5), set(70, 5), set(45, 12)])).toEqual(['warmup', 'work', 'work']);
  });

  it('reads added weight on a bodyweight exercise with the body counted', () => {
    expect(kinds([set(0, 3), set(15, 6), set(15, 5)], 'body')).toEqual(['warmup', 'work', 'work']);
    // Bodyweight alone is most of the load here, so the first set is real work.
    expect(kinds([set(0, 6), set(5, 6), set(5, 6)], 'body')).toEqual(['work', 'work', 'work']);
    expect(kinds([set(0, 12), set(10, 10), set(20, 8)], 'body')).toEqual(['work', 'work', 'work']);
  });

  it('keeps bodyweight sets with no added weight at all', () => {
    expect(kinds([set(0, 12), set(0, 10), set(0, 8)], 'body')).toEqual(['work', 'work', 'work']);
  });

  it('only compares sets at one level', () => {
    const across = [set(10, 3, { level: 2 }), set(30, 6, { level: 5 }), set(30, 5, { level: 5 })];
    expect(kinds(across)).toEqual(['work', 'work', 'work']);
    const within = [set(10, 3, { level: 5 }), set(30, 6, { level: 5 }), set(30, 5, { level: 5 })];
    expect(kinds(within)).toEqual(['warmup', 'work', 'work']);
    expect(effectiveSets(within, 'weight', body)[0].level).toBe(5);
    expect(kinds([set(0, 3, { level: 2 }), set(0, 8, { level: 5 })], 'body')).toEqual(['work', 'work']);
  });

  it('changes only the ramp-up set when it’s the one lighter set', () => {
    const sets = [warm(20, 8), set(35, 4), set(70, 6), set(70, 6), set(70, 5)];
    const read = effectiveSets(sets, 'weight', body);
    expect(read.map((s) => s.kind)).toEqual(['warmup', 'warmup', 'work', 'work', 'work']);
    expect(read.map((s) => s.weightKg)).toEqual([20, 35, 70, 70, 70]);
    expect(read[2]).toBe(sets[2]);
  });

  it('leaves a session of one set alone', () => {
    const sets = [set(70, 5, { failure: true })];
    expect(effectiveSets(sets, 'weight', body)).toBe(sets);
  });

  it('leaves timed sets alone, weight or no weight', () => {
    const sets = [set(0, 0, { seconds: 20 }), set(10, 0, { seconds: 40 }), set(20, 0, { seconds: 60 })];
    expect(effectiveSets(sets, 'time', body)).toBe(sets);
  });

  it('keeps a set with no result, and ignores a missed attempt as the top weight', () => {
    expect(kinds([set(40, 0), set(70, 5)])).toEqual(['work', 'work']);
    expect(kinds([set(40, 3), set(70, 5), set(90, 0)])).toEqual(['warmup', 'work', 'work']);
  });

  it('never changes the sets it was given', () => {
    const sets = [set(40, 3, { failure: true }), set(70, 5)];
    effectiveSets(sets, 'weight', body);
    expect(sets[0]).toEqual({ kind: 'work', weightKg: 40, reps: 3, failure: true });
  });

  describe('across rows', () => {
    const row = (workoutId: string, exerciseId: string, entry: number, order: number, weightKg: number, reps: number) => ({
      ...set(weightKg, reps),
      workoutId,
      exerciseId,
      entry,
      order,
    });
    const read = (rows: ReturnType<typeof row>[], loadOf: (id: string) => Exercise['load'] | undefined = () => 'weight') =>
      effectiveRows(rows, loadOf, body);

    it('reads each session by itself and keeps the order given', () => {
      const rows = [row('a', 'press', 0, 1, 70, 5), row('b', 'press', 0, 0, 40, 3), row('a', 'press', 0, 0, 40, 3), row('c', 'row', 1, 0, 40, 3)];
      expect(read(rows).map((s) => s.kind)).toEqual(['work', 'work', 'warmup', 'work']);
      expect(read(rows).map((s) => s.workoutId)).toEqual(['a', 'b', 'a', 'c']);
    });

    it('reads an exercise done twice in a workout as one session', () => {
      const rows = [row('a', 'press', 3, 0, 70, 5), row('a', 'press', 1, 0, 40, 3)];
      expect(read(rows).map((s) => s.kind)).toEqual(['work', 'warmup']);
    });

    it('keeps the stored kind when the exercise is gone', () => {
      const rows = [row('a', 'gone', 0, 0, 40, 3), row('a', 'gone', 0, 1, 70, 5)];
      expect(read(rows, () => undefined).map((s) => s.kind)).toEqual(['work', 'work']);
    });
  });
});

describe('progress across a session\u2019s sets', () => {
  const steady = (date: string) => session(date, [50, 9], [50, 8], [47.5, 8]);
  /** Seven alike sessions, a stall by any measure, then the given session. */
  const stalledThen = (next?: (date: string) => Session): Session[] => {
    const history = dates('2031-01-06', 7, 7).map(steady);
    return next ? [...history, next('2031-02-24')] : history;
  };
  const today = '2031-02-26';
  const statusOf = (history: Session[], load: Exercise['load'] = 'weight') => exerciseStatus(strengthPoints(history, load, 75), { today });

  it('starts from a real stall', () => {
    expect(statusOf(stalledThen()).state).toBe('stalled');
    expect(statusOf(stalledThen(steady)).state).toBe('stalled');
  });

  it('reads more on the later sets as progress when the top set only ties', () => {
    const history = stalledThen((date) => session(date, [50, 9], [50, 9], [50, 8]));
    const status = statusOf(history);
    expect(status).toMatchObject({ state: 'progressing', acrossSets: true, sessionsSinceBest: 0, weeksSinceBest: 0 });
    expect(status.bestDate).toBe('2031-01-06');
    const compared = compareExercise(history[7].sets, history[6].sets, { position: 1, previousPosition: 1, cost: 0, load: 'weight', bodyKg: 75 });
    expect(compared?.trend).toBe('up');
  });

  it('agrees in the suggestion, with no raise on a tied top set', () => {
    const history = stalledThen((date) => session(date, [50, 9], [50, 9], [50, 8]));
    const s = suggestSets(press, history, { today, status: statusOf(history) })!;
    expect(s.reason).toBe('moreReps');
    expect(s.weightKg).toBe(50);
    expect(s.reps).toBe(10);
    const stuck = stalledThen(steady);
    expect(suggestSets(press, stuck, { today, status: statusOf(stuck) })!.reason).toBe('noIncrease');
  });

  it('claims no record', () => {
    const history = stalledThen((date) => session(date, [50, 9], [50, 9], [50, 8]));
    expect(newBests(history, 'weight', 75)).toEqual([]);
    expect(exerciseRecords(history, 'weight', 75).bestEstimateDate).toBe('2031-01-06');
  });

  it('reads heavier back-off sets as progress', () => {
    const before = (date: string) => session(date, [100, 8], [80, 10], [80, 10]);
    const history = [...dates('2031-01-06', 7, 7).map(before), session('2031-02-24', [100, 8], [85, 10], [85, 10])];
    expect(statusOf(history).state).toBe('progressing');
  });

  it('gives a light extra set nothing', () => {
    expect(statusOf(stalledThen((date) => session(date, [50, 9], [50, 8], [47.5, 8], [20, 10]))).state).toBe('stalled');
    expect(statusOf(stalledThen((date) => session(date, [50, 9], [50, 8], [47.5, 8], [50, 3]))).state).toBe('stalled');
  });

  it('counts a real added set, once', () => {
    const more = (date: string) => session(date, [50, 9], [50, 8], [47.5, 8], [50, 7]);
    expect(statusOf(stalledThen(more)).state).toBe('progressing');
    const repeated = [...stalledThen(more), ...dates('2031-03-03', 6, 7).map(more)];
    expect(exerciseStatus(strengthPoints(repeated, 'weight', 75), { today: '2031-04-09' }).state).toBe('stalled');
  });

  it('keeps noise inside the band', () => {
    expect(statusOf(stalledThen((date) => session(date, [50, 9], [50, 8], [48, 8]))).state).toBe('stalled');
    expect(statusOf(stalledThen((date) => session(date, [50, 8], [50, 9], [47.5, 8]))).state).toBe('stalled');
  });

  it('treats one more rep at the same weights as the workout card does', () => {
    const history = stalledThen((date) => session(date, [50, 9], [50, 8], [47.5, 9]));
    expect(statusOf(history).state).toBe('progressing');
    const compared = compareExercise(history[7].sets, history[6].sets, { position: 1, previousPosition: 1, cost: 0, load: 'weight', bodyKg: 75 });
    expect(compared?.percent).toBeLessThan(1);
    expect(compared?.trend).toBe('up');
  });

  it('needs the session to beat the best work so far, not just the last one', () => {
    const dip = (date: string) => session(date, [50, 9], [47.5, 7], [45, 7]);
    const history = [...stalledThen(), ...dates('2031-02-24', 1, 7).map(dip), session('2031-03-03', [50, 9], [50, 8], [47.5, 8])];
    expect(exerciseStatus(strengthPoints(history, 'weight', 75), { today: '2031-03-05' }).sessionsSinceBest).toBe(8);
  });

  it('does not count a shorter session, or a fallen top set', () => {
    expect(statusOf(stalledThen((date) => session(date, [50, 9], [50, 9]))).state).toBe('stalled');
    expect(statusOf(stalledThen((date) => session(date, [45, 9], [45, 9], [45, 9], [45, 9]))).state).toBe('stalled');
  });

  it('stays at the level compared', () => {
    const at = (date: string, level: number, ...reps: number[]): Session => ({ ...session(date), sets: reps.map((n) => ({ kind: 'work', weightKg: 0, reps: n, level })) });
    const same = dates('2031-01-06', 7, 7).map((date) => at(date, 12, 12, 10, 9));
    const otherSet = { ...at('2031-02-24', 12, 12, 10, 9), sets: [...at('2031-02-24', 12, 12, 10, 9).sets, { kind: 'work' as const, weightKg: 0, reps: 14, level: 11 }] };
    expect(statusOf([...same, otherSet], 'body').state).toBe('stalled');
    expect(statusOf([...same, at('2031-02-24', 12, 12, 11, 10)], 'body').state).toBe('progressing');
    const moved = atLatestLevel([...same, at('2031-02-24', 11, 12, 11, 10)]);
    expect(moved).toHaveLength(1);
  });

  it('works on timed exercises, with a band for the timer', () => {
    const timed = (date: string, ...seconds: number[]): Session => ({ ...session(date), sets: seconds.map((s) => ({ kind: 'work', weightKg: 0, reps: 0, seconds: s })) });
    const same = dates('2031-01-06', 7, 7).map((date) => timed(date, 60, 50, 40));
    expect(statusOf([...same, timed('2031-02-24', 60, 55, 50)], 'time').state).toBe('progressing');
    expect(statusOf([...same, timed('2031-02-24', 60, 50, 41)], 'time').state).toBe('stalled');
    const options = { position: 1, previousPosition: 1, cost: 0, load: 'time' as const, bodyKg: 75 };
    expect(compareExercise(timed('a', 60, 50, 41).sets, timed('b', 60, 50, 40).sets, options)?.trend).toBe('same');
  });

  it('works on bodyweight exercises', () => {
    const same = dates('2031-01-06', 7, 7).map((date) => session(date, [0, 12], [0, 10]));
    expect(statusOf([...same, session('2031-02-24', [0, 12], [0, 12])], 'body').state).toBe('progressing');
  });

  it('lets an off day count when it made progress, and only then', () => {
    const offDay = (s: Session): Session => ({ ...s, offDay: true });
    expect(statusOf(stalledThen((date) => offDay(session(date, [50, 9], [50, 9], [50, 8])))).state).toBe('progressing');
    expect(statusOf(stalledThen((date) => offDay(session(date, [50, 9], [40, 8], [40, 8])))).state).toBe('stalled');
  });

  it('allows for a session moved earlier in the workout', () => {
    const late = dates('2031-01-06', 7, 7).map((date) => ({ ...steady(date), position: 4 }));
    const early = { ...session('2031-02-24', [50, 9], [50, 8], [47.5, 9]), position: 1 };
    const points = strengthPoints([...late, early], 'weight', 75);
    expect(exerciseStatus(points, { today }).state).toBe('progressing');
    expect(exerciseStatus(points, { today, positionCost: 0.025 }).state).toBe('stalled');
  });

  it('never counts ramp-up sets stored as work', () => {
    const read = (date: string, ...sets: [number, number][]): Session => {
      const s = session(date, ...sets);
      return { ...s, sets: effectiveSets(s.sets, 'weight', 75) };
    };
    const same = dates('2031-01-06', 7, 7).map((date) => read(date, [20, 8], [50, 9], [50, 8], [47.5, 8]));
    expect(statusOf([...same, read('2031-02-24', [30, 9], [50, 9], [50, 8], [47.5, 8])]).state).toBe('stalled');
  });

  it('does not call work well below the best progress', () => {
    const history = [
      session('2031-01-06', [40, 8], [40, 8]),
      session('2031-01-13', [60, 8]),
      ...dates('2031-01-20', 3, 7).map((date) => session(date, [50, 8], [50, 8], [50, 8])),
    ];
    const status = exerciseStatus(strengthPoints(history, 'weight', 75), { today: '2031-02-05' });
    expect(status.acrossSets).toBeUndefined();
    expect(status.state).not.toBe('progressing');
  });

  it('has nothing to compare on points without sets', () => {
    expect(beatsAcrossSets({ date: 'a', value: 100 }, { date: 'b', value: 90 })).toBe(false);
  });

  describe('and plateau choices', () => {
    const record: StallRecord = { id: 'r', exerciseId: 'x', action: 'repRange', date: '2031-02-20' };

    it('notes that a choice helped when progress followed', () => {
      const history = stalledThen((date) => session(date, [50, 9], [50, 9], [50, 8]));
      expect(stallOutcome(record, strengthPoints(history, 'weight', 75), today)).toBe(true);
    });

    it('stays open while nothing has changed, then says it didn\u2019t help', () => {
      const history = stalledThen(steady);
      const points = strengthPoints(history, 'weight', 75);
      expect(stallOutcome(record, points, today)).toBeUndefined();
      expect(stallOutcome(record, points, '2031-06-01')).toBe(false);
    });
  });
});

describe('direction of the recent sessions', () => {
  /** A date three days after the last of these points, so no break comes into it. */
  const statusOf = (values: number[], extra: { goal?: 'maintain' } = {}) => {
    const p = points(values, '2031-01-06', 7);
    const d = new Date(`${p[p.length - 1].date}T12:00:00`);
    d.setDate(d.getDate() + 3);
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return exerciseStatus(p, { today, ...extra });
  };
  const rebuilding = [175, 165, 155, 150, 145, 143, 143, 147, 154];

  it('reads a climb from an old peak as building back', () => {
    const status = statusOf(rebuilding);
    expect(status.state).toBe('progressing');
    expect(status.buildingBack).toBe(true);
    expect(status.best).toBe(175);
  });

  it('lets the suggestion follow', () => {
    const p = points(rebuilding, '2031-01-06', 7);
    const history = p.map((point) => session(point.date, [point.value / (1 + 8 / 30), 8]));
    const status = exerciseStatus(p, { today: '2031-03-10' });
    expect(suggestSets(press, history, { today: '2031-03-10', status })!.reason).not.toBe('noIncrease');
  });

  it('keeps a real slide dropping', () => {
    expect(statusOf([175, 165, 160, 155, 150, 145, 140, 135, 130]).state).toBe('dropping');
  });

  it('is not flipped by one good day after a slide', () => {
    const status = statusOf([175, 165, 160, 155, 150, 145, 140, 135, 155]);
    expect(status.state).toBe('dropping');
    expect(status.buildingBack).toBeUndefined();
  });

  it('is not flipped by one bad day in a climb', () => {
    expect(statusOf([...rebuilding, 146, 156]).buildingBack).toBe(true);
  });

  it('sees a climb in three sessions, for an exercise done rarely', () => {
    const old = points([175, 175, 175], '2030-03-04', 7);
    const recent = points([143, 147, 154], '2031-01-06', 30);
    const status = exerciseStatus([...old, ...recent], { today: '2031-03-10', ignoreFall: true });
    expect(status.state).toBe('progressing');
    expect(status.buildingBack).toBe(true);
    expect(isRising([143, 147, 154])).toBe(true);
  });

  it('needs both later sessions clear of the first of three', () => {
    expect(isRising([143, 143.5, 170])).toBe(false);
    expect(isRising([143, 139, 170])).toBe(false);
    expect(isRising([143, 154])).toBe(false);
  });

  it('reads the chart\u2019s numbers, not ones allowed for position', () => {
    const p = [175, 165, 155, 150, 145, 143, 147, 154].map((value, i) => ({ ...points([value], '2031-01-06')[0], date: dates('2031-01-06', 8, 7)[i], position: i < 6 ? 3 : i === 6 ? 2 : 1 }));
    const status = exerciseStatus(p, { today: '2031-03-05', positionCost: 0.03 });
    expect(status.state).toBe('progressing');
    expect(status.buildingBack).toBe(true);
  });

  it('keeps a session done later from reading as a fall the chart doesn\u2019t show', () => {
    const flat = dates('2031-01-06', 8, 7).map((date, i) => ({ date, value: 100, position: i < 5 ? 1 : 3 }));
    expect(exerciseStatus(flat, { today: '2031-03-05', positionCost: 0.03 }).state).not.toBe('dropping');
  });

  it.each([
    ['one rep up', [175, 165, 150, 150, 150, 153, 153]],
    ['reps going up and down', [175, 165, 150, 155, 150, 155, 150, 155]],
    ['a bad day, then flat', [175, 165, 155, 150, 140, 150, 151, 150, 151, 152]],
    ['a step up that stayed', [175, 165, 155, 145, 152, 152, 152, 152]],
  ])('does not call %s building back', (_, values) => {
    const status = statusOf(values);
    expect(status.buildingBack).toBeUndefined();
    expect(status.state).toBe('stalled');
  });

  it('calls flat sessions below an old peak stalled, not dropping', () => {
    expect(statusOf([175, 165, 155, 145, 143, 143, 143, 143, 143, 143]).state).toBe('stalled');
  });

  it('keeps a slight wobble out of it', () => {
    expect(statusOf([100, 100, 100, 100, 100, 99, 100, 101, 100, 100]).state).toBe('stalled');
  });

  it('ignores sessions from before the chart\u2019s shortest range when reading direction', () => {
    const old = points([175, 175, 175], '2030-04-01', 7);
    const recent = points([140, 140, 140, 140], '2031-01-06', 7);
    expect(exerciseStatus([...old, ...recent], { today: '2031-01-30', ignoreFall: true }).state).not.toBe('dropping');
  });

  it('holds on a maintain goal, whichever way it\u2019s heading', () => {
    expect(statusOf(rebuilding, { goal: 'maintain' })).toMatchObject({ state: 'holding' });
    expect(statusOf(rebuilding, { goal: 'maintain' }).buildingBack).toBeUndefined();
    expect(statusOf([175, 165, 160, 155, 150, 145, 140, 135, 130], { goal: 'maintain' }).state).toBe('holding');
  });
});
