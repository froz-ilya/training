import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeWorkout,
  addExercise,
  addSet,
  createWorkout,
  deleteNote,
  deleteWorkout,
  effectiveHistory,
  finishedWorkouts,
  finishWorkout,
  isStorageFull,
  lastPerformance,
  moveExercise,
  planForEditing,
  recentExerciseIds,
  removeExercise,
  removeSet,
  repeatWorkout,
  saveNote,
  restoreSnapshot,
  setMachineSetting,
  startWorkout,
  summarize,
  updateSet,
  updateWorkout,
  applyPlan,
  createFromPlan,
  replaceExercise,
} from './repo';
import { db, newId } from './schema';
import { exportBackup } from './backup';
import { loadExerciseView, loadProgress } from '../coach/data';
import { sessionCells } from '../coach/overview';
import { groupEntries, nextOpenSet } from '../workout/entries';
import type { CustomExercise, SetKind, Workout } from '../types';
import { fmtDuration, fmtSet, summarizeSets } from '../workout/format';
import { stepValue } from '../workout/steps';

const setsOf = (id: string) => db.sets.where('workoutId').equals(id).toArray();

/** A finished workout with one exercise. Every number here is invented. */
async function logged(date: string, exerciseId: string, numbers: [number, number][]): Promise<string> {
  const id = await createWorkout({ date });
  const entry = await addExercise(id, exerciseId);
  const [first] = await setsOf(id);
  await updateSet(first.id, { weightKg: numbers[0][0], reps: numbers[0][1] });
  for (const [weightKg, reps] of numbers.slice(1)) await updateSet(await addSet(id, entry), { weightKg, reps });
  await finishWorkout(id);
  return id;
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('workouts', () => {
  it('starts an active workout dated today', async () => {
    const id = await createWorkout();
    expect((await activeWorkout())?.id).toBe(id);
  });

  it('moves the copy of the date on sets when a workout changes date', async () => {
    const id = await createWorkout({ date: '2031-03-01' });
    await addExercise(id, 'deadlift');
    await updateWorkout(id, { date: '2031-03-02' });
    expect((await db.workouts.get(id))?.date).toBe('2031-03-02');
    expect((await setsOf(id)).map((s) => s.date)).toEqual(['2031-03-02']);
  });

  it('starting a planned workout moves it to today', async () => {
    const id = await createWorkout({ date: '2031-03-01', status: 'planned' });
    await addExercise(id, 'deadlift');
    await startWorkout(id);
    const workout = await db.workouts.get(id);
    expect(workout?.status).toBe('active');
    expect(workout?.startedAt).toBeGreaterThan(0);
    expect((await setsOf(id))[0].date).toBe(workout?.date);
    expect(workout?.date).not.toBe('2031-03-01');
  });

  it('finishing marks unchecked sets done by default', async () => {
    const id = await createWorkout();
    await addExercise(id, 'deadlift');
    expect(await finishWorkout(id)).toBe(true);
    expect((await db.workouts.get(id))?.status).toBe('done');
    expect((await setsOf(id)).every((s) => s.done)).toBe(true);
  });

  it('finishing can discard unchecked sets and keep the rest', async () => {
    const id = await createWorkout();
    const entry = await addExercise(id, 'deadlift');
    const kept = (await setsOf(id))[0];
    await updateSet(kept.id, { done: true });
    await addSet(id, entry);
    expect(await finishWorkout(id, 'discard')).toBe(true);
    expect((await setsOf(id)).map((s) => s.id)).toEqual([kept.id]);
  });

  it('drops the workout when discarding leaves nothing', async () => {
    const id = await createWorkout();
    await addExercise(id, 'deadlift');
    expect(await finishWorkout(id, 'discard')).toBe(false);
    expect(await db.workouts.get(id)).toBeUndefined();
    expect(await setsOf(id)).toEqual([]);
  });

  it('delete and undo restore a workout with its sets', async () => {
    const id = await logged('2031-03-01', 'deadlift', [[100, 5]]);
    const snapshot = await deleteWorkout(id);
    expect(await db.workouts.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
    await restoreSnapshot(snapshot);
    expect(await db.workouts.count()).toBe(1);
    expect(await db.sets.count()).toBe(1);
  });

  it('repeating copies exercises and numbers into a new unchecked workout', async () => {
    const source = await logged('2031-03-01', 'deadlift', [
      [100, 5],
      [90, 8],
    ]);
    const copy = await repeatWorkout(source);
    const workout = await db.workouts.get(copy);
    const sets = (await setsOf(copy)).sort((a, b) => a.order - b.order);
    expect(workout).toMatchObject({ status: 'active' });
    expect(sets.map((s) => [s.weightKg, s.reps, s.done])).toEqual([
      [100, 5, false],
      [90, 8, false],
    ]);
    expect(await setsOf(source)).toHaveLength(2);
  });
});

describe('last performance', () => {
  it('finds the latest finished workout, sets in order', async () => {
    await logged('2031-03-01', 'dips', [[10, 8]]);
    const latest = await logged('2031-03-05', 'dips', [
      [15, 6],
      [10, 9],
    ]);
    const last = await lastPerformance('dips');
    expect(last?.workoutId).toBe(latest);
    expect(last?.date).toBe('2031-03-05');
    expect(last?.sets.map((s) => s.reps)).toEqual([6, 9]);
  });

  it('ignores planned and active workouts and the workout being logged', async () => {
    const finished = await logged('2031-03-01', 'dips', [[10, 8]]);
    const planned = await createWorkout({ date: '2031-03-09', status: 'planned' });
    await addExercise(planned, 'dips');
    const active = await createWorkout({ date: '2031-03-10' });
    await addExercise(active, 'dips');
    expect((await lastPerformance('dips', { excludeWorkoutId: active }))?.workoutId).toBe(finished);
  });

  it('looks before a date when editing an old workout', async () => {
    const early = await logged('2031-03-01', 'dips', [[10, 8]]);
    const middle = await logged('2031-03-05', 'dips', [[12, 8]]);
    await logged('2031-03-09', 'dips', [[14, 8]]);
    const last = await lastPerformance('dips', { before: '2031-03-05', excludeWorkoutId: middle });
    expect(last?.workoutId).toBe(early);
  });

  it('says where the exercise came in that workout', async () => {
    const id = await createFromPlan(
      {
        exercises: [
          { exerciseId: 'deadlift', sets: [{ kind: 'work', weightKg: 100, reps: 5 }] },
          { exerciseId: 'dips', sets: [{ kind: 'work', weightKg: 10, reps: 8 }] },
        ],
      },
      'active',
    );
    await finishWorkout(id, 'done');
    expect((await lastPerformance('deadlift'))?.position).toBe(1);
    expect((await lastPerformance('dips'))?.position).toBe(2);
  });

  it('counts position by order, whatever gaps entries have', async () => {
    const id = await createWorkout();
    for (const exercise of ['deadlift', 'plank', 'dips']) await addExercise(id, exercise);
    await removeExercise(id, 1);
    await finishWorkout(id, 'done');
    expect((await lastPerformance('dips'))?.position).toBe(2);
  });

  it('is null for a new exercise', async () => {
    expect(await lastPerformance('dips')).toBeNull();
  });
});

describe('exercises in a workout', () => {
  it('fills a new exercise from last time, unchecked', async () => {
    await logged('2031-03-01', 'dips', [
      [10, 8],
      [15, 6],
    ]);
    const id = await createWorkout({ date: '2031-03-08' });
    await addExercise(id, 'dips');
    const sets = (await setsOf(id)).sort((a, b) => a.order - b.order);
    expect(sets.map((s) => [s.weightKg, s.reps, s.done, s.date])).toEqual([
      [10, 8, false, '2031-03-08'],
      [15, 6, false, '2031-03-08'],
    ]);
  });

  it('keeps seconds of timed exercises when copying', async () => {
    const past = await createWorkout({ date: '2031-03-01' });
    await addExercise(past, 'plank');
    await updateSet((await setsOf(past))[0].id, { seconds: 100 });
    await finishWorkout(past);
    const id = await createWorkout({ date: '2031-03-02' });
    await addExercise(id, 'plank');
    expect((await setsOf(id))[0].seconds).toBe(100);
  });

  it('starts an unknown exercise with one empty work set', async () => {
    const id = await createWorkout();
    await addExercise(id, 'dips');
    expect(await setsOf(id)).toMatchObject([{ kind: 'work', weightKg: 0, reps: 0, done: false, entry: 0, order: 0 }]);
  });

  it('adds sets to a finished workout as already done', async () => {
    const id = await logged('2031-03-01', 'dips', [[10, 8]]);
    const setId = await addSet(id, 0);
    expect(await db.sets.get(setId)).toMatchObject({ done: true, weightKg: 10, reps: 8, order: 1 });
  });

  it('removing an exercise only touches its own card, and undo restores it', async () => {
    const id = await createWorkout();
    await addExercise(id, 'dips');
    const second = await addExercise(id, 'deadlift');
    const snapshot = await removeExercise(id, second);
    expect((await setsOf(id)).map((s) => s.exerciseId)).toEqual(['dips']);
    await restoreSnapshot(snapshot);
    expect(await setsOf(id)).toHaveLength(2);
  });

  it('moves exercises and stops at the ends', async () => {
    const id = await createWorkout();
    await addExercise(id, 'dips');
    await addExercise(id, 'deadlift');
    await addExercise(id, 'plank');
    await moveExercise(id, 2, -1);
    expect(groupEntries(await setsOf(id)).map((e) => e.exerciseId)).toEqual(['dips', 'plank', 'deadlift']);
    await moveExercise(id, 0, -1);
    expect(groupEntries(await setsOf(id)).map((e) => e.exerciseId)).toEqual(['dips', 'plank', 'deadlift']);
  });

  it('moves past a gap left by a removed exercise', async () => {
    const id = await createWorkout();
    await addExercise(id, 'dips');
    await addExercise(id, 'deadlift');
    await addExercise(id, 'plank');
    await removeExercise(id, 1);
    await moveExercise(id, 2, -1);
    expect(groupEntries(await setsOf(id)).map((e) => e.exerciseId)).toEqual(['plank', 'dips']);
  });

  it('removing a set returns it for undo', async () => {
    const id = await createWorkout();
    await addExercise(id, 'dips');
    const [set] = await setsOf(id);
    const snapshot = await removeSet(set.id);
    expect(await setsOf(id)).toEqual([]);
    await restoreSnapshot(snapshot);
    expect(await setsOf(id)).toHaveLength(1);
  });

  it('stores fractional weights exactly', async () => {
    const id = await createWorkout();
    await addExercise(id, 'rope-pushdown');
    const [set] = await setsOf(id);
    await updateSet(set.id, { weightKg: 34.875 });
    expect((await db.sets.get(set.id))?.weightKg).toBe(34.875);
  });
});

describe('lists', () => {
  it('counts exercises and sets per workout', async () => {
    const id = await createWorkout();
    await addExercise(id, 'dips');
    await addSet(id, 0);
    await addExercise(id, 'deadlift');
    const empty = await createWorkout();
    const summaries = await summarize([id, empty]);
    expect(summaries.get(id)).toMatchObject({ exercises: 2, sets: 3 });
    expect(summaries.get(empty)).toEqual({ exercises: 0, sets: 0, groups: [] });
  });

  it('says what a workout trained, counting a custom exercise by its muscle', async () => {
    await db.customExercises.put({ id: 'custom-a', names: { en: 'Mine', de: '', ru: '' }, muscle: 'legs', equipment: 'other', load: 'weight', compound: true, createdAt: 1 });
    const id = await createWorkout();
    await addExercise(id, 'custom-a');
    await addExercise(id, 'barbell-bench-press');
    expect((await summarize([id])).get(id)?.groups).toEqual(['chest', 'legs']);
  });

  it('lists finished workouts newest first, up to a limit', async () => {
    await logged('2031-03-01', 'dips', [[10, 8]]);
    const newest = await logged('2031-03-09', 'dips', [[10, 8]]);
    await logged('2031-03-05', 'dips', [[10, 8]]);
    await createWorkout({ date: '2031-03-20' });
    const workouts = await finishedWorkouts(2);
    expect(workouts).toHaveLength(2);
    expect(workouts[0].id).toBe(newest);
  });

  it('lists recent exercises newest first without repeats', async () => {
    await logged('2031-03-01', 'dips', [[10, 8]]);
    await logged('2031-03-05', 'deadlift', [[100, 5]]);
    await logged('2031-03-09', 'dips', [[10, 8]]);
    expect(await recentExerciseIds()).toEqual(['dips', 'deadlift']);
  });
});

describe('exercise settings', () => {
  it('saves a machine setting without touching other fields', async () => {
    await db.exerciseSettings.put({ exerciseId: 'pec-deck', stepKg: 1.25 });
    await setMachineSetting('pec-deck', 'Seat 9');
    expect(await db.exerciseSettings.get('pec-deck')).toMatchObject({ stepKg: 1.25, machineSetting: 'Seat 9' });
  });
});

describe('helpers', () => {
  const set = (weightKg: number, reps: number, kind: 'warmup' | 'work' = 'work') =>
    ({ id: `${weightKg}-${reps}`, workoutId: 'w', exerciseId: 'e', date: '2031-03-01', entry: 0, order: 0, kind, weightKg, reps, done: false });

  it('picks the next open set, wrapping round', () => {
    const a = { ...set(1, 1), id: 'a', done: true };
    const b = { ...set(1, 1), id: 'b', order: 1 };
    const c = { ...set(1, 1), id: 'c', entry: 1 };
    const entries = groupEntries([c, a, b]);
    expect(nextOpenSet(entries)?.id).toBe('b');
    expect(nextOpenSet(entries, 'b')?.id).toBe('c');
    expect(nextOpenSet(entries, 'c')?.id).toBe('b');
    expect(nextOpenSet(groupEntries([{ ...a }]), 'a')).toBeUndefined();
  });

  it('steps without float noise and never below zero', () => {
    expect(stepValue(0.1, 0.2, 1)).toBe(0.3);
    expect(stepValue(34.875, 1.25, -1)).toBe(33.625);
    expect(stepValue(1, 2.5, -1)).toBe(0);
  });

  it('formats durations', () => {
    expect(fmtDuration(100)).toBe('1:40');
    expect(fmtDuration(5)).toBe('0:05');
  });

  it('writes sets by how the exercise is measured', () => {
    expect(fmtSet({ weightKg: 62.5, reps: 8 }, 'weight')).toBe('62.5 kg × 8');
    expect(fmtSet({ weightKg: 10, reps: 8 }, 'body')).toBe('+10 kg × 8');
    expect(fmtSet({ weightKg: 0, reps: 12 }, 'body')).toBe('× 12');
    expect(fmtSet({ weightKg: 0, reps: 0, seconds: 95 }, 'time')).toBe('1:35');
  });

  it('summarizes work sets, grouping equal weights and skipping warm-ups', () => {
    const sets = [set(20, 15, 'warmup'), set(60, 8), set(60, 7), set(55, 10)];
    expect(summarizeSets(sets, 'weight')).toBe('60 kg × 8, 7 · 55 kg × 10');
  });

  it('summarizes only warm-ups when that is all there is', () => {
    expect(summarizeSets([set(20, 15, 'warmup')], 'weight')).toBe('20 kg × 15');
  });
});

describe('plans', () => {
  it('does not repeat planned sets already done', async () => {
    const id = await createFromPlan(
      { exercises: [{ exerciseId: 'deadlift', sets: [{ kind: 'warmup', weightKg: 40, reps: 8 }, { kind: 'work', weightKg: 100, reps: 5 }] }] },
      'active',
    );
    const sets = await db.sets.where('workoutId').equals(id).toArray();
    await db.sets.update(sets.find((s) => s.kind === 'warmup')!.id, { done: true });
    await applyPlan(id, 0, [
      { kind: 'warmup', weightKg: 40, reps: 8 },
      { kind: 'work', weightKg: 105, reps: 5 },
    ]);
    const after = await db.sets.where('workoutId').equals(id).toArray();
    expect(after.map((s) => [s.kind, s.weightKg]).sort()).toEqual([['warmup', 40], ['work', 105]]);
  });

  const plan = {
    exercises: [
      {
        exerciseId: 'barbell-bench-press',
        sets: [
          { kind: 'warmup' as const, weightKg: 20, reps: 12 },
          { kind: 'work' as const, weightKg: 60, reps: 8 },
        ],
      },
      { exerciseId: 'plank', sets: [{ kind: 'work' as const, weightKg: 0, reps: 0, seconds: 60 }] },
    ],
  };

  it('creates a workout with every planned set, nothing done', async () => {
    const id = await createFromPlan(plan, 'planned');
    const sets = await db.sets.where('workoutId').equals(id).toArray();
    expect((await db.workouts.get(id))?.status).toBe('planned');
    expect(sets).toHaveLength(3);
    expect(sets.every((s) => !s.done)).toBe(true);
    expect(sets.find((s) => s.exerciseId === 'plank')?.seconds).toBe(60);
  });

  it('replaces only unfinished sets when a suggestion is applied', async () => {
    const id = await createFromPlan(plan, 'active');
    const sets = await db.sets.where('workoutId').equals(id).toArray();
    const warmup = sets.find((s) => s.kind === 'warmup')!;
    await db.sets.update(warmup.id, { done: true });
    await applyPlan(id, 0, [
      { kind: 'work', weightKg: 62.5, reps: 8 },
      { kind: 'work', weightKg: 62.5, reps: 8 },
    ]);
    const after = (await db.sets.where('workoutId').equals(id).toArray()).filter((s) => s.entry === 0).sort((a, b) => a.order - b.order);
    expect(after.map((s) => [s.weightKg, s.done])).toEqual([[20, true], [62.5, false], [62.5, false]]);
    expect(after.map((s) => s.order)).toEqual([0, 1, 2]);
  });
});

describe('replacing an exercise', () => {
  it('keeps the open sets when a suggestion is applied, so the rows change in place', async () => {
    const id = await createFromPlan(
      { exercises: [{ exerciseId: 'deadlift', sets: [{ kind: 'warmup', weightKg: 40, reps: 8 }, { kind: 'work', weightKg: 100, reps: 5 }] }] },
      'active',
    );
    const before = await setsOf(id);
    await applyPlan(id, 0, [
      { kind: 'warmup', weightKg: 40, reps: 8 },
      { kind: 'work', weightKg: 102.5, reps: 5 },
      { kind: 'work', weightKg: 102.5, reps: 5 },
    ]);
    const after = (await setsOf(id)).sort((a, b) => a.order - b.order);
    expect(after.map((s) => [s.kind, s.weightKg])).toEqual([['warmup', 40], ['work', 102.5], ['work', 102.5]]);
    expect(after.slice(0, 2).map((s) => s.id)).toEqual(before.sort((a, b) => a.order - b.order).map((s) => s.id));

    await applyPlan(id, 0, [{ kind: 'work', weightKg: 100, reps: 5 }]);
    expect((await setsOf(id)).map((s) => s.kind)).toEqual(['work']);
  });

  it('puts the new exercise in the same place with last time’s sets, and undo brings the old one back', async () => {
    await logged('2026-01-05', 'leg-press', [[120, 10], [120, 9]]);
    const id = await createFromPlan(
      {
        exercises: [
          { exerciseId: 'barbell-squat', sets: [{ kind: 'work', weightKg: 80, reps: 5 }] },
          { exerciseId: 'hip-adductor', sets: [{ kind: 'work', weightKg: 40, reps: 12 }] },
          { exerciseId: 'plank', sets: [{ kind: 'work', weightKg: 0, reps: 0, seconds: 60 }] },
        ],
      },
      'active',
    );
    const before = await setsOf(id);
    const snapshot = await replaceExercise(id, 1, 'leg-press');
    const entries = groupEntries(await setsOf(id));
    expect(entries.map((e) => e.exerciseId)).toEqual(['barbell-squat', 'leg-press', 'plank']);
    expect(entries[1].sets.map((s) => [s.weightKg, s.reps, s.done])).toEqual([[120, 10, false], [120, 9, false]]);

    await restoreSnapshot(snapshot);
    expect((await setsOf(id)).map((s) => s.id).sort()).toEqual(before.map((s) => s.id).sort());
  });

  it('never replaces an exercise with work already done', async () => {
    const id = await createFromPlan({ exercises: [{ exerciseId: 'hip-adductor', sets: [{ kind: 'work', weightKg: 40, reps: 12 }] }] }, 'active');
    const [set] = await setsOf(id);
    await updateSet(set.id, { done: true });
    await expect(replaceExercise(id, 0, 'leg-press')).rejects.toThrow();
    expect((await setsOf(id)).map((s) => s.exerciseId)).toEqual(['hip-adductor']);
  });
});

describe('comments', () => {
  async function noted() {
    const id = await createFromPlan({ exercises: [{ exerciseId: 'deadlift', sets: [{ kind: 'work', weightKg: 100, reps: 5 }] }] }, 'active');
    const set = (await db.sets.where('workoutId').equals(id).toArray())[0];
    const base = { workoutId: id, exerciseId: 'deadlift', date: set.date };
    return { id, set, base };
  }

  it('saves, updates and removes a comment', async () => {
    const { base } = await noted();
    const id = await saveNote({ ...base, tags: ['tired'], text: '  slept badly ' });
    expect(await db.exerciseNotes.get(id!)).toMatchObject({ tags: ['tired'], text: 'slept badly' });
    await saveNote({ ...base, id: id!, tags: [], text: '' });
    expect(await db.exerciseNotes.count()).toBe(0);
    expect(await saveNote({ ...base, tags: [], text: ' ' })).toBeNull();
    const again = await saveNote({ ...base, tags: ['pain'] });
    await deleteNote(again!);
    expect(await db.exerciseNotes.count()).toBe(0);
  });

  it('moves comments with the workout date', async () => {
    const { id, base } = await noted();
    await saveNote({ ...base, tags: ['tired'] });
    await updateWorkout(id, { date: '2026-01-15' });
    expect((await db.exerciseNotes.toArray())[0].date).toBe('2026-01-15');
  });

  it('removes comments with the workout, and undo brings them back', async () => {
    const { id, base } = await noted();
    await saveNote({ ...base, tags: ['tired'] });
    const snapshot = await deleteWorkout(id);
    expect(await db.exerciseNotes.count()).toBe(0);
    await restoreSnapshot(snapshot);
    expect(await db.exerciseNotes.count()).toBe(1);
  });

  it('removes a set comment with its set, and undo brings it back', async () => {
    const { set, base } = await noted();
    await saveNote({ ...base, tags: ['badSpotter'], setId: set.id });
    const snapshot = await removeSet(set.id);
    expect(await db.exerciseNotes.count()).toBe(0);
    await restoreSnapshot(snapshot);
    expect((await db.exerciseNotes.toArray())[0].setId).toBe(set.id);
  });

  it('keeps comments when one of two entries of an exercise is removed', async () => {
    const { id, base } = await noted();
    await addExercise(id, 'deadlift');
    await saveNote({ ...base, tags: ['tired'] });
    await removeExercise(id, 1);
    expect(await db.exerciseNotes.count()).toBe(1);
    await removeExercise(id, 0);
    expect(await db.exerciseNotes.count()).toBe(0);
  });

  it('doesn\u2019t copy comments when a workout is repeated', async () => {
    const { id, base } = await noted();
    await saveNote({ ...base, tags: ['tired'] });
    await repeatWorkout(id);
    expect(await db.exerciseNotes.count()).toBe(1);
  });
});

describe('failure and level', () => {
  async function trained(date: string): Promise<string> {
    const id = await createWorkout({ date });
    await addExercise(id, 'inverted-row');
    const [first] = await setsOf(id);
    await updateSet(first.id, { reps: 10, level: 12, failure: true });
    await finishWorkout(id);
    return id;
  }

  it('saves both on a set', async () => {
    const [set] = await setsOf(await trained('2031-03-01'));
    expect(set).toMatchObject({ level: 12, failure: true });
  });

  it('repeating a workout keeps the level and the failure mark', async () => {
    const [set] = await setsOf(await repeatWorkout(await trained('2031-03-01')));
    expect(set).toMatchObject({ level: 12, failure: true, done: false });
  });

  it('a new card and a new set start from last time’s level and failure mark', async () => {
    await trained('2031-03-01');
    const id = await createWorkout({ date: '2031-03-08' });
    const entry = await addExercise(id, 'inverted-row');
    const added = await db.sets.get(await addSet(id, entry));
    const [first] = await setsOf(id);
    expect(first).toMatchObject({ level: 12, failure: true });
    expect(added).toMatchObject({ level: 12, failure: true });
  });

  it('starts a set unmarked when last time’s wasn’t to failure', async () => {
    const past = await trained('2031-03-01');
    const [set] = await setsOf(past);
    await updateSet(set.id, { failure: false });
    const id = await createWorkout({ date: '2031-03-08' });
    await addExercise(id, 'inverted-row');
    expect((await setsOf(id))[0].failure).toBeUndefined();
  });

  it('a plan keeps its level', async () => {
    const id = await createFromPlan({ exercises: [{ exerciseId: 'inverted-row', sets: [{ kind: 'work', weightKg: 0, reps: 10, level: 11 }] }] }, 'active');
    expect((await setsOf(id))[0].level).toBe(11);
  });
});

describe('sets Focus added', () => {
  const plan = {
    exercises: [
      {
        exerciseId: 'barbell-bench-press',
        sets: [
          { kind: 'work' as const, weightKg: 50, reps: 8, extra: false },
          { kind: 'work' as const, weightKg: 50, reps: 8 },
          { kind: 'work' as const, weightKg: 50, reps: 8, extra: true },
        ],
      },
    ],
  };
  const marks = async (id: string) => (await setsOf(id)).sort((a, b) => a.order - b.order).map((s) => s.extra);

  it('stores the mark only on the sets that have it', async () => {
    const id = await createFromPlan(plan, 'active');
    expect(await marks(id)).toEqual([undefined, undefined, true]);
    expect((await setsOf(id)).some((s) => 'extra' in s && s.extra !== true)).toBe(false);
  });

  it('keeps it when a plan is applied to a card', async () => {
    const id = await createFromPlan({ exercises: [{ exerciseId: 'barbell-bench-press', sets: [{ kind: 'work', weightKg: 50, reps: 8 }] }] }, 'active');
    await applyPlan(id, 0, plan.exercises[0].sets);
    expect(await marks(id)).toEqual([undefined, undefined, true]);
  });

  it('never marks a set added by hand, even after an extra one', async () => {
    const id = await createFromPlan(plan, 'active');
    const added = await db.sets.get(await addSet(id, 0));
    expect(added).toMatchObject({ weightKg: 50, reps: 8 });
    expect(added?.extra).toBeUndefined();
  });

  it('repeating a workout keeps the sets but not the mark', async () => {
    const id = await createFromPlan(plan, 'active');
    await finishWorkout(id);
    const copy = await repeatWorkout(id);
    expect(await marks(copy)).toEqual([undefined, undefined, undefined]);
  });

  it('a new card starts from last time’s usual sets, without the extra one', async () => {
    const id = await createFromPlan(plan, 'active');
    await finishWorkout(id);
    const next = await createWorkout({ date: '2099-01-01' });
    await addExercise(next, 'barbell-bench-press');
    expect(await marks(next)).toEqual([undefined, undefined]);
  });
});

describe('editing the next workout', () => {
  const draft = (...exerciseIds: string[]) => ({
    exercises: exerciseIds.map((exerciseId) => ({ exerciseId, sets: [{ kind: 'work' as const, weightKg: 60, reps: 8 }] })),
  });

  it('opens the same plan however many times Edit is tapped', async () => {
    const first = await planForEditing(draft('deadlift', 'dips'));
    expect(await planForEditing(draft('deadlift', 'dips'))).toBe(first);
    expect(await db.workouts.count()).toBe(1);
    expect(await db.sets.count()).toBe(2);
  });

  it('makes one plan from two taps at once', async () => {
    const [a, b] = await Promise.all([planForEditing(draft('deadlift')), planForEditing(draft('deadlift'))]);
    expect(a).toBe(b);
    expect(await db.workouts.count()).toBe(1);
  });

  it('keeps changes made to the plan when opening it again', async () => {
    const id = await planForEditing(draft('deadlift'));
    await addExercise(id, 'dips');
    expect(await planForEditing(draft('deadlift'))).toBe(id);
    expect(await setsOf(id)).toHaveLength(2);
  });

  it('gives a switched plan its own workout, and goes back to the first', async () => {
    const first = await planForEditing(draft('deadlift', 'dips'));
    const switched = await planForEditing(draft('bench-press', 'push-up'));
    expect(switched).not.toBe(first);
    expect((await setsOf(switched)).map((s) => s.exerciseId).sort()).toEqual(['bench-press', 'push-up']);
    expect(await planForEditing(draft('deadlift', 'dips'))).toBe(first);
    expect(await planForEditing(draft('bench-press', 'push-up'))).toBe(switched);
    expect(await db.workouts.count()).toBe(2);
  });

  it('tells apart two plans that start the same but share little', async () => {
    const first = await planForEditing(draft('treadmill', 'deadlift', 'dips', 'row'));
    expect(await planForEditing(draft('treadmill', 'push-up', 'curl', 'plank'))).not.toBe(first);
  });

  it('tells apart two plans that share most exercises but start differently', async () => {
    const first = await planForEditing(draft('squat', 'leg-press', 'curl'));
    expect(await planForEditing(draft('deadlift', 'leg-press', 'curl'))).not.toBe(first);
  });

  it('reuses an older plan for the same exercises', async () => {
    const id = await createFromPlan(draft('deadlift', 'dips'), 'planned');
    await updateWorkout(id, { date: '2031-03-01' });
    expect(await planForEditing(draft('deadlift', 'dips'))).toBe(id);
  });

  it('makes a new plan when an older one is for other exercises', async () => {
    const old = await createFromPlan(draft('dips'), 'planned');
    await updateWorkout(old, { date: '2031-03-01' });
    expect(await planForEditing(draft('deadlift'))).not.toBe(old);
    expect(await db.workouts.count()).toBe(2);
  });

  it('makes a new plan once the last one has been started', async () => {
    const id = await planForEditing(draft('deadlift'));
    await startWorkout(id);
    expect(await planForEditing(draft('deadlift'))).not.toBe(id);
  });
});

describe('storage errors', () => {
  const quota = { name: 'QuotaExceededError' };

  it('recognises a full device, also when Dexie wraps the error', () => {
    expect(isStorageFull(quota)).toBe(true);
    expect(isStorageFull({ name: 'AbortError', inner: quota })).toBe(true);
    expect(isStorageFull({ name: 'ModifyError', failures: [quota] })).toBe(true);
  });

  it('leaves other errors alone', () => {
    expect(isStorageFull({ name: 'ConstraintError' })).toBe(false);
    expect(isStorageFull({ name: 'ModifyError', failures: [{ name: 'DataError' }] })).toBe(false);
    expect(isStorageFull(undefined)).toBe(false);
    expect(isStorageFull('QuotaExceededError')).toBe(false);
  });
});

describe('ramp-up sets stored as work', () => {
  type Numbers = [weightKg: number, reps: number, failure?: boolean];

  /** Rows stored as a converter would leave them. Every number here is invented. */
  async function stored(date: string, exerciseId: string, numbers: Numbers[], status: Workout['status'] = 'done', kind: SetKind = 'work'): Promise<string> {
    const id = await createWorkout({ date, status });
    await db.sets.bulkAdd(
      numbers.map(([weightKg, reps, failure], order) => {
        const row = { id: newId(), workoutId: id, exerciseId, date, entry: 0, order, kind, weightKg, reps, done: status === 'done' };
        return failure ? { ...row, failure } : row;
      }),
    );
    return id;
  }

  const ramp: Numbers[] = [[40, 3, true], [70, 5, true], [67.5, 5], [65, 6]];
  const shape = (sets: { kind: SetKind; weightKg: number; failure?: boolean }[]) => sets.map((s) => [s.kind, s.weightKg, !!s.failure]);
  const inOrder = async (id: string) => (await setsOf(id)).sort((a, b) => a.order - b.order);

  it('last performance reads it as a warm-up and leaves the stored row alone', async () => {
    const id = await stored('2031-03-01', 'deadlift', ramp);
    const before = await inOrder(id);
    expect(shape((await lastPerformance('deadlift'))!.sets)).toEqual([
      ['warmup', 40, false],
      ['work', 70, true],
      ['work', 67.5, false],
      ['work', 65, false],
    ]);
    expect(await inOrder(id)).toEqual(before);
    expect(before[0]).toMatchObject({ kind: 'work', failure: true });
  });

  it('a new card starts it as a warm-up, and real work with last time\u2019s failure mark', async () => {
    await stored('2031-03-01', 'deadlift', ramp);
    const id = await createWorkout({ date: '2031-03-08' });
    await addExercise(id, 'deadlift');
    expect(shape(await inOrder(id))).toEqual([
      ['warmup', 40, false],
      ['work', 70, true],
      ['work', 67.5, false],
      ['work', 65, false],
    ]);
  });

  it('repeating a finished workout copies it as a warm-up', async () => {
    const source = await stored('2031-03-01', 'deadlift', ramp);
    const sets = shape(await inOrder(await repeatWorkout(source)));
    expect(sets[0]).toEqual(['warmup', 40, false]);
    expect(sets[1]).toEqual(['work', 70, true]);
    expect((await inOrder(source))[0]).toMatchObject({ kind: 'work', failure: true });
  });

  it('never rereads a workout that isn\u2019t finished', async () => {
    const id = await stored('2031-03-01', 'deadlift', ramp, 'active');
    expect(await lastPerformance('deadlift')).toBeNull();
    expect(shape(await inOrder(await repeatWorkout(id)))[0]).toEqual(['work', 40, true]);
  });

  it('keeps sets the user marked themselves as they are', async () => {
    await stored('2031-03-01', 'deadlift', [[40, 3], [70, 5]], 'done', 'warmup');
    expect((await lastPerformance('deadlift'))?.sets.map((s) => s.kind)).toEqual(['warmup', 'warmup']);
  });

  it('reads a custom exercise by its own load, also while adding it to a workout', async () => {
    const custom = (id: string, load: CustomExercise['load']): CustomExercise => ({
      id,
      names: { en: id, de: id, ru: id },
      muscle: 'chest',
      equipment: 'other',
      load,
      compound: false,
      createdAt: 0,
    });
    await db.customExercises.bulkAdd([custom('custom-weighted', 'weight'), custom('custom-timed', 'time')]);
    await stored('2031-03-01', 'custom-weighted', ramp);
    await stored('2031-03-01', 'custom-timed', ramp);
    const id = await createWorkout({ date: '2031-03-08' });
    const kinds = async (entry: number) => (await setsOf(id)).filter((s) => s.entry === entry).sort((a, b) => a.order - b.order)[0].kind;
    expect(await kinds(await addExercise(id, 'custom-weighted'))).toBe('warmup');
    expect(await kinds(await addExercise(id, 'custom-timed'))).toBe('work');
  });

  it('keeps the stored kind for an exercise that no longer exists', async () => {
    const id = await stored('2031-03-01', 'custom-gone', ramp);
    expect((await effectiveHistory(await setsOf(id))).every((s) => s.kind === 'work')).toBe(true);
  });

  it('summaries count it as a warm-up once finished, and as stored before that', async () => {
    const mixed = async (status: Workout['status']) => {
      const id = await stored('2031-03-01', 'deadlift', [[30, 2], [80, 6]], status);
      const chest = { workoutId: id, exerciseId: 'barbell-bench-press', date: '2031-03-01', entry: 1, kind: 'work' as const, weightKg: 50, reps: 5, done: status === 'done' };
      await db.sets.bulkAdd([0, 1, 2, 3, 4].map((order) => ({ ...chest, id: newId(), order })));
      return id;
    };
    const finished = await mixed('done');
    const planned = await mixed('planned');
    const summaries = await summarize([finished, planned]);
    expect(summaries.get(finished)).toMatchObject({ exercises: 2, sets: 7, groups: ['chest'] });
    expect(summaries.get(planned)).toMatchObject({ exercises: 2, sets: 7, groups: ['chest', 'back'] });
  });

  it('sessions, progress and tables all see the same sets, and backups the raw rows', async () => {
    await stored('2031-03-01', 'deadlift', ramp);
    await stored('2031-03-08', 'deadlift', [[42.5, 3, true], [72.5, 5], [70, 5], [67.5, 6]]);
    const view = await loadExerciseView('deadlift');
    expect(view?.sessions.map((s) => s.sets.filter((set) => set.kind === 'work').length)).toEqual([3, 3]);
    expect(sessionCells(view!.sessions[1], view!.sessions[0], 'weight').map((c) => [c.set.weightKg, c.better])).toEqual([
      [72.5, 'weight'],
      [70, 'weight'],
      [67.5, 'weight'],
    ]);
    const progress = await loadProgress();
    expect(progress.views[0].sessions).toEqual(view?.sessions);
    expect((await db.sets.toArray()).every((s) => s.kind === 'work')).toBe(true);
    const backup = JSON.parse(await (await exportBackup()).text());
    expect(JSON.stringify(backup)).not.toContain('"warmup"');
  });
});
