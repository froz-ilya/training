import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toISODate } from '../dates';
import { db } from '../db/schema';
import { setUiLang } from '../i18n.svelte';
import type { CustomExercise, Exercise, Muscle, WorkoutSet } from '../types';
import { compareExercise } from './compare';
import { loadExerciseView, loadPriorWork } from './data';
import { HELPER_WEIGHT, priorWork, type WorkoutRow } from './fatigue';
import { adjustPoints, expectedLoss, fatigueLoss, FATIGUE_PER_SET, MAX_FATIGUE } from './position';
import { exerciseStatus } from './status';
import type { PriorWork, Session, SessionSet, StrengthPoint } from './strength';
import { suggestSets } from './suggest';
import { earlierWorkText, reasonText } from './text';

const BODY = 75;

function exercise(id: string, muscle: Muscle, extras: Partial<Exercise> = {}): Exercise {
  return { id, names: { en: id, de: id, ru: id }, muscle, equipment: 'machine', load: 'weight', compound: false, ...extras };
}

const chestPress = exercise('chest-press', 'chest', { compound: true, helpers: ['triceps', 'shoulders'] });
const pushdown = exercise('pushdown', 'triceps');
const skullCrusher = exercise('skull-crusher', 'triceps');
const curl = exercise('curl', 'biceps');
const fly = exercise('fly', 'chest');
const plank = exercise('plank', 'abs', { load: 'time' });
const crunch = exercise('crunch', 'abs');
const all = new Map([chestPress, pushdown, skullCrusher, curl, fly, plank, crunch].map((e) => [e.id, e]));

const work = (weightKg: number, reps: number): SessionSet => ({ kind: 'work', weightKg, reps });
const warm = (weightKg: number, reps: number): SessionSet => ({ kind: 'warmup', weightKg, reps });

const rows = (exerciseId: string, entry: number, ...sets: SessionSet[]): WorkoutRow[] =>
  sets.map((set, order) => ({ ...set, exerciseId, entry, order }));

describe('counting earlier work', () => {
  it('counts a main muscle in full and a helper in part', () => {
    expect(priorWork(fly, rows('chest-press', 1, work(60, 8), work(60, 8)), 2, all, BODY)).toEqual({ sets: 2, muscle: 'chest' });
    expect(priorWork(pushdown, rows('chest-press', 1, work(60, 8), work(60, 8)), 2, all, BODY)).toEqual({
      sets: 2 * HELPER_WEIGHT,
      muscle: 'triceps',
    });
  });

  it('adds up everything above the card, and nothing below it', () => {
    const workout = [...rows('chest-press', 1, work(60, 8), work(60, 8)), ...rows('skull-crusher', 2, work(20, 10)), ...rows('pushdown', 3, work(30, 10)), ...rows('skull-crusher', 4, work(20, 10))];
    expect(priorWork(pushdown, workout, 3, all, BODY)).toEqual({ sets: 2, muscle: 'triceps' });
  });

  it('leaves out warm-ups', () => {
    expect(priorWork(pushdown, rows('skull-crusher', 1, warm(10, 15), warm(15, 10)), 2, all, BODY)).toBeNull();
    expect(priorWork(pushdown, rows('skull-crusher', 1, warm(10, 15), work(20, 10)), 2, all, BODY)?.sets).toBe(1);
  });

  it('leaves out ramp-up sets stored as work', () => {
    const ramped = rows('skull-crusher', 1, work(10, 10), work(15, 10), work(25, 10));
    expect(priorWork(pushdown, ramped, 2, all, BODY)?.sets).toBe(1);
  });

  it('leaves out sets with no result', () => {
    expect(priorWork(pushdown, rows('skull-crusher', 1, work(20, 0)), 2, all, BODY)).toBeNull();
  });

  it('counts a timed set that has a time', () => {
    const timed = rows('plank', 1, { kind: 'work', weightKg: 0, reps: 0, seconds: 45 }, { kind: 'work', weightKg: 0, reps: 0 });
    expect(priorWork(crunch, timed, 2, all, BODY)?.sets).toBe(1);
  });

  it('counts nothing from a muscle the exercise has nothing to do with', () => {
    expect(priorWork(pushdown, rows('curl', 1, work(15, 10)), 2, all, BODY)).toBeNull();
  });

  it('works with an exercise that has no helpers on either side', () => {
    expect(priorWork(curl, rows('fly', 1, work(20, 12)), 2, all, BODY)).toBeNull();
    expect(priorWork(fly, rows('fly', 1, work(20, 12)), 2, all, BODY)?.sets).toBe(1);
  });

  it('skips an exercise that no longer exists', () => {
    expect(priorWork(pushdown, rows('gone', 1, work(20, 10)), 2, all, BODY)).toBeNull();
  });

  describe('custom exercises', () => {
    const mine = exercise('custom-cable-press', 'triceps');
    const known = new Map([...all, [mine.id, mine]]);

    it('match on their main muscle', () => {
      expect(priorWork(pushdown, rows('custom-cable-press', 1, work(20, 10)), 2, known, BODY)?.sets).toBe(1);
      expect(priorWork(mine, rows('pushdown', 1, work(20, 10)), 2, known, BODY)?.sets).toBe(1);
    });

    it('still feel a catalogue exercise that lists their muscle as a helper', () => {
      expect(priorWork(mine, rows('chest-press', 1, work(60, 8)), 2, known, BODY)?.sets).toBe(HELPER_WEIGHT);
    });

    it('have no helpers of their own', () => {
      expect(priorWork(exercise('custom-row', 'back'), rows('custom-cable-press', 1, work(20, 10)), 2, known, BODY)).toBeNull();
    });
  });

  describe('a muscle trained directly first', () => {
    it('tires a press only through its helpers, and only in part', () => {
      const first = rows('pushdown', 1, work(30, 10), work(30, 10), work(30, 10), work(30, 10));
      expect(priorWork(chestPress, first, 2, all, BODY)).toEqual({ sets: 4 * HELPER_WEIGHT, muscle: 'triceps' });
    });

    it('does nothing to a press that doesn’t list that muscle', () => {
      expect(priorWork(exercise('hack-press', 'chest'), rows('pushdown', 1, work(30, 10)), 2, all, BODY)).toBeNull();
      expect(priorWork(chestPress, rows('curl', 1, work(15, 10)), 2, all, BODY)).toBeNull();
    });

    it('names the muscle that took most of the work', () => {
      const mixed = [...rows('pushdown', 1, work(30, 10), work(30, 10), work(30, 10)), ...rows('fly', 2, work(20, 12))];
      expect(priorWork(chestPress, mixed, 3, all, BODY)).toEqual({ sets: 2.5, muscle: 'triceps' });
    });
  });
});

describe('expected loss', () => {
  it('grows with the sets, up to the cap', () => {
    expect(fatigueLoss(0)).toBe(0);
    expect(fatigueLoss(2)).toBeCloseTo(2 * FATIGUE_PER_SET);
    expect(fatigueLoss(500)).toBe(MAX_FATIGUE);
  });

  it('is the larger of position and earlier work, never the sum', () => {
    expect(expectedLoss(3, 0.025, 4)).toBeCloseTo(0.06);
    expect(expectedLoss(5, 0.025, 4)).toBeCloseTo(0.1);
    expect(expectedLoss(3, 0.025)).toBeCloseTo(0.05);
  });

  it('leaves position alone with no earlier work', () => {
    const position = [1, 1, 3].map((p) => ({ date: `2026-01-0${p}`, value: 100, position: p }));
    const adjusted = adjustPoints(position, 0.025);
    expect(adjusted[0].value).toBe(100);
    expect(adjusted[2].value).toBeCloseTo(100 / 0.95);
  });
});

describe('comparing with last time', () => {
  const options = { position: 2, previousPosition: 2, cost: 0.025, load: 'weight' as const, bodyKg: BODY };
  const triceps: PriorWork = { sets: 4, muscle: 'triceps' };
  const now = [work(40, 9), work(40, 9)];
  const before = [work(40, 10), work(40, 10)];

  it('reads triceps after presses as expected, and names the muscle', () => {
    expect(compareExercise(now, before, { ...options, priorWork: triceps })).toMatchObject({
      trend: 'expected',
      percent: -2.5,
      expectedPercent: -3.5,
      fatigued: 'triceps',
    });
  });

  it('reads the same dip with no earlier work as down', () => {
    const result = compareExercise(now, before, options)!;
    expect(result.trend).toBe('down');
    expect(result.fatigued).toBeUndefined();
    expect(compareExercise(now, before, { ...options, priorWork: null })?.trend).toBe('down');
  });

  it('explains nothing when last time had the same work first', () => {
    expect(compareExercise(now, before, { ...options, priorWork: triceps, previousPriorWork: triceps })?.trend).toBe('down');
  });

  it('counts only the difference from last time', () => {
    const result = compareExercise(now, before, { ...options, priorWork: { sets: 5, muscle: 'triceps' }, previousPriorWork: { sets: 2, muscle: 'triceps' } })!;
    expect(result.expectedPercent).toBe(-4.5);
    expect(result.trend).toBe('expected');
  });

  it('takes the larger of position and earlier work, not the sum', () => {
    const fromFirst = { ...options, position: 3, previousPosition: 1 };
    expect(compareExercise(now, before, { ...fromFirst, priorWork: triceps })?.expectedPercent).toBe(-6);
    const late = compareExercise(now, before, { ...fromFirst, position: 5, priorWork: triceps })!;
    expect(late.expectedPercent).toBe(-10);
    // Order alone explains this one, so the card has no muscle to name.
    expect(late.fatigued).toBeUndefined();
  });

  it('holds to the cap, so a big real drop still reads down', () => {
    const fromFirst = { ...options, previousPosition: 1, priorWork: { sets: 40, muscle: 'triceps' as const } };
    expect(compareExercise([work(36.5, 10)], [work(40, 10)], fromFirst)).toMatchObject({ trend: 'down', expectedPercent: -7.5 });
    expect(compareExercise([work(37.5, 10)], [work(40, 10)], fromFirst)?.trend).toBe('expected');
  });

  it('never goes past the limit on what position explains', () => {
    const lateAndTired = { ...options, position: 9, previousPosition: 1, cost: 0.05, priorWork: { sets: 40, muscle: 'triceps' as const } };
    expect(compareExercise(now, before, lateAndTired)?.expectedPercent).toBe(-10);
  });

  it('gives no allowance with no previous position to compare with', () => {
    expect(compareExercise(now, before, { ...options, previousPosition: null, priorWork: triceps })).toMatchObject({ trend: 'down', expectedPercent: 0 });
  });

  it('doesn’t name a muscle for a dip only an off day explains', () => {
    const big = compareExercise([work(30, 10)], [work(40, 10)], { ...options, offDay: true, priorWork: triceps })!;
    expect(big.trend).toBe('expected');
    expect(big.fatigued).toBeUndefined();
  });

  it('leaves gains alone', () => {
    expect(compareExercise([work(45, 10)], [work(40, 10)], { ...options, priorWork: triceps })?.trend).toBe('up');
  });
});

describe('status', () => {
  const today = '2026-03-10';
  const dates = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'];
  /** Eight weekly sessions at the same place: five fresh ones, then three at `value`. */
  const history = (value: number, priorSets?: number): StrengthPoint[] =>
    dates.map((date, i) => ({
      date,
      value: i < 5 ? 100 : value,
      position: 2,
      ...(i >= 5 && priorSets ? { priorSets } : {}),
    }));

  it('doesn’t read holding level after heavier earlier work as a stall', () => {
    expect(exerciseStatus(history(100), { today, positionCost: 0.025 }).state).toBe('stalled');
    expect(exerciseStatus(history(100, 4), { today, positionCost: 0.025 }).state).not.toBe('stalled');
  });

  it('allows for earlier work with a learned position cost of nothing', () => {
    expect(exerciseStatus(history(100, 4), { today, positionCost: 0 }).state).not.toBe('stalled');
  });

  it('still reads a big real fall as dropping, whatever was done first', () => {
    expect(exerciseStatus(history(85, 40), { today, positionCost: 0.025 }).state).toBe('dropping');
  });

  it('allows for each session’s own earlier work and leaves the numbers themselves alone', () => {
    const points = history(100, 4);
    const before = structuredClone(points);
    const adjusted = adjustPoints(points, 0.025);
    expect(points).toEqual(before);
    expect(adjusted[0].value).toBe(100);
    expect(adjusted[7].value).toBeCloseTo(100 / 0.965);
  });
});

describe('suggestions', () => {
  const today = '2026-03-10';
  const session = (position: number, reps: number, prior?: PriorWork): Session => ({
    workoutId: 'a',
    date: '2026-03-06',
    position,
    sets: [work(40, reps)],
    ...(prior ? { priorWork: prior } : {}),
  });
  const triceps = (sets: number): PriorWork => ({ sets, muscle: 'triceps' });

  it('holds instead of adding a rep when today has more earlier work', () => {
    const s = suggestSets(pushdown, [session(2, 10)], { today, position: 2, priorWork: triceps(4) })!;
    expect(s).toMatchObject({ reason: 'earlierWork', weightKg: 40, reps: 10 });
    expect(s.params.muscle).toBe('triceps');
  });

  it('holds instead of stepping up, and never lowers the weight', () => {
    const s = suggestSets(pushdown, [session(2, 12)], { today, position: 2, priorWork: triceps(4) })!;
    expect(s).toMatchObject({ reason: 'earlierWork', weightKg: 40, reps: 12 });
  });

  it('gives up one rep when there’s much more', () => {
    const s = suggestSets(pushdown, [session(2, 10)], { today, position: 2, priorWork: triceps(6) })!;
    expect(s).toMatchObject({ reason: 'earlierWork', weightKg: 40, reps: 9 });
  });

  it('keeps the usual increase when fatigue is comparable to last time', () => {
    const same = suggestSets(pushdown, [session(2, 10, triceps(4))], { today, position: 2, priorWork: triceps(4) })!;
    expect(same).toMatchObject({ reason: 'moreReps', reps: 11 });
    const close = suggestSets(pushdown, [session(2, 10, triceps(3))], { today, position: 2, priorWork: triceps(4) })!;
    expect(close).toMatchObject({ reason: 'moreReps', reps: 11 });
    const up = suggestSets(pushdown, [session(2, 12, triceps(4))], { today, position: 2, priorWork: triceps(4) })!;
    expect(up.reason).toBe('up');
  });

  it('keeps the usual increase when today has less', () => {
    expect(suggestSets(pushdown, [session(2, 10, triceps(4))], { today, position: 2, priorWork: triceps(1) })?.reason).toBe('moreReps');
    expect(suggestSets(pushdown, [session(2, 10)], { today, position: 2, priorWork: null })?.reason).toBe('moreReps');
  });

  it('doesn’t take off reps for earlier work on top of a later slot', () => {
    const s = suggestSets(pushdown, [session(2, 10)], { today, position: 3, priorWork: triceps(6) })!;
    expect(s).toMatchObject({ reason: 'laterInWorkout', reps: 9 });
  });

  it('doesn’t call today easier when the order changed and more work comes first', () => {
    const s = suggestSets(pushdown, [session(3, 10)], { today, position: 2, priorWork: triceps(6) })!;
    expect(s).toMatchObject({ reason: 'earlierWork', reps: 10 });
    const lighter = suggestSets(pushdown, [session(3, 10)], { today, position: 2, priorWork: triceps(1) })!;
    expect(lighter.reason).toBe('earlierInWorkout');
  });

  it('goes by the session it builds on, not the latest', () => {
    const older: Session = { ...session(2, 10), workoutId: 'b', date: '2026-03-03' };
    const latest: Session = { ...session(4, 8, triceps(4)) };
    const s = suggestSets(pushdown, [older, latest], { today, position: 2, priorWork: triceps(4) })!;
    expect(s).toMatchObject({ reason: 'earlierWork', weightKg: 40, reps: 10 });
    expect(s.params.baseDate).toBe('2026-03-03');
  });

  it('leaves the other reasons alone', () => {
    const setting = { exerciseId: 'pushdown', goal: 'maintain' as const };
    expect(suggestSets(pushdown, [session(2, 10)], { today, position: 2, priorWork: triceps(6), setting })?.reason).toBe('maintain');
    expect(suggestSets(pushdown, [session(2, 10)], { today, position: 2, priorWork: triceps(6), lighterWeek: true })?.reason).toBe('lighterWeek');
    expect(suggestSets(pushdown, [{ ...session(2, 10), pain: true }], { today, position: 2, priorWork: triceps(6) })?.reason).toBe('pain');
  });

  it('does nothing away from a workout', () => {
    expect(suggestSets(pushdown, [session(2, 10)], { today, priorWork: triceps(6) })?.reason).toBe('moreReps');
  });

  it('holds a timed exercise at last time’s time', () => {
    const timed: Session = { workoutId: 'a', date: '2026-03-06', position: 2, sets: [{ kind: 'work', weightKg: 0, reps: 0, seconds: 60 }] };
    const s = suggestSets(plank, [timed], { today, position: 2, priorWork: { sets: 4, muscle: 'abs' } })!;
    expect(s).toMatchObject({ reason: 'earlierWork', seconds: 60 });
    expect(suggestSets(plank, [timed], { today, position: 2 })?.reason).toBe('moreTime');
  });
});

describe('saying why', () => {
  afterEach(() => setUiLang('en'));
  const history: Session[] = [{ workoutId: 'a', date: '2026-03-06', position: 2, sets: [work(40, 10)] }];
  const held = suggestSets(pushdown, history, { today: '2026-03-10', position: 2, priorWork: { sets: 4, muscle: 'triceps' } })!;
  const fewer = suggestSets(pushdown, history, { today: '2026-03-10', position: 2, priorWork: { sets: 6, muscle: 'triceps' } })!;

  it.each([
    ['en', 'Triceps'],
    ['de', 'Trizeps'],
    ['ru', 'Трицепс'],
  ] as const)('names the muscle in %s', (lang, name) => {
    setUiLang(lang);
    expect(earlierWorkText('triceps')).toContain(name);
    expect(reasonText(held)).toContain(name);
    expect(reasonText(fewer)).toContain(name);
    expect(reasonText(fewer)).not.toBe(reasonText(held));
    const dated = { ...held, params: { ...held.params, baseDate: '2026-03-03' } };
    expect(reasonText(dated)).not.toBe(reasonText(held));
  });
});

describe('on the device', () => {
  const custom = (e: Exercise): CustomExercise => ({ ...e, createdAt: 1 });
  const press = custom(exercise('custom-press', 'chest', { compound: true, helpers: ['triceps'] }));
  const extension = custom(exercise('custom-extension', 'triceps'));
  const row = custom(exercise('custom-row', 'back'));
  let nextId = 0;

  const addSets = (workoutId: string, date: string, exerciseId: string, entry: number, count: number, done: boolean, weightKg = 40): Promise<unknown> =>
    db.sets.bulkAdd(
      Array.from({ length: count }, (_, order): WorkoutSet => ({ id: `s${nextId++}`, workoutId, exerciseId, date, entry, order, kind: 'work', weightKg, reps: 10, done })),
    );
  const earlier = toISODate(new Date(Date.now() - 3 * 86_400_000));
  const addWorkout = (id: string, date: string, status: 'done' | 'active' | 'planned') =>
    db.workouts.add({ id, date, status, source: 'app', updatedAt: 1 });

  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.customExercises.bulkAdd([press, extension, row]);
  });

  it('counts today’s sets above the card as they’re ticked, and last time’s from that session', async () => {
    await addWorkout('before', '2026-03-03', 'done');
    await addSets('before', '2026-03-03', 'custom-press', 1, 2, true);
    await addSets('before', '2026-03-03', 'custom-extension', 2, 3, true);
    await addWorkout('today', '2026-03-10', 'active');
    await addSets('today', '2026-03-10', 'custom-press', 1, 4, false);
    await addSets('today', '2026-03-10', 'custom-extension', 2, 3, false);

    const read = () => loadPriorWork('custom-extension', 'today', 2, 'before');
    expect(await read()).toEqual({ today: null, previous: { sets: 1, muscle: 'triceps' } });

    const [first, second] = await db.sets.where('workoutId').equals('today').filter((s) => s.entry === 1).toArray();
    await db.sets.update(first.id, { done: true });
    expect((await read()).today).toEqual({ sets: 0.5, muscle: 'triceps' });
    await db.sets.update(second.id, { done: true });
    expect((await read()).today).toEqual({ sets: 1, muscle: 'triceps' });
    await db.sets.update(second.id, { done: false });
    expect((await read()).today).toEqual({ sets: 0.5, muscle: 'triceps' });
  });

  it('gives each past session its own earlier work, for the status', async () => {
    await addWorkout('fresh', '2026-03-03', 'done');
    await addSets('fresh', '2026-03-03', 'custom-row', 1, 3, true);
    await addSets('fresh', '2026-03-03', 'custom-extension', 2, 3, true);
    await addWorkout('tired', '2026-03-06', 'done');
    await addSets('tired', '2026-03-06', 'custom-press', 1, 4, true);
    await addSets('tired', '2026-03-06', 'custom-extension', 2, 3, true);

    const view = (await loadExerciseView('custom-extension'))!;
    expect(view.sessions.map((s) => s.priorWork)).toEqual([undefined, { sets: 2, muscle: 'triceps' }]);
    expect(view.points.map((p) => p.priorSets)).toEqual([undefined, 2]);
    // What the chart draws stays what was lifted.
    expect(view.points[0].value).toBe(view.points[1].value);
  });

  it('plans from the whole of today’s order, done or not', async () => {
    await addWorkout('before', earlier, 'done');
    await addSets('before', earlier, 'custom-row', 1, 3, true);
    await addSets('before', earlier, 'custom-extension', 2, 3, true);
    await addWorkout('today', toISODate(), 'active');
    await addSets('today', toISODate(), 'custom-press', 1, 12, false);
    await addSets('today', toISODate(), 'custom-extension', 2, 3, false);

    const view = (await loadExerciseView('custom-extension', 2))!;
    expect(view.suggestion).toMatchObject({ reason: 'earlierWork', weightKg: 40 });
    expect(view.suggestion?.reps).toBeLessThanOrEqual(10);
    expect(view.suggestion?.params.muscle).toBe('triceps');
  });

  it('adds nothing for an exercise at a different place in the open workout', async () => {
    await addWorkout('before', earlier, 'done');
    await addSets('before', earlier, 'custom-row', 1, 3, true);
    await addSets('before', earlier, 'custom-extension', 2, 3, true);
    await addWorkout('today', toISODate(), 'active');
    await addSets('today', toISODate(), 'custom-press', 1, 12, false);
    await addSets('today', toISODate(), 'custom-row', 2, 3, false);

    expect((await loadExerciseView('custom-extension', 2))?.suggestion?.reason).not.toBe('earlierWork');
  });
});
