import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/schema';
import { fmtMinutes, workoutMinutes } from '../workout/format';
import type { ExerciseNote, SetKind, WorkoutSet, WorkoutStatus } from '../types';
import { compareExercise } from './compare';
import { loadWorkoutSummary } from './data';
import type { SessionSet } from './strength';

const BENCH = 'barbell-bench-press';
const SQUAT = 'barbell-squat';

let nextId = 0;

interface Plan {
  exerciseId: string;
  entry?: number;
  sets: [weightKg: number, reps: number, kind?: SetKind][];
}

async function workout(id: string, date: string, plans: Plan[], status: WorkoutStatus = 'done', times = {}) {
  await db.workouts.add({ id, date, status, source: 'app', updatedAt: 1, ...times });
  await db.sets.bulkAdd(
    plans.flatMap(({ exerciseId, entry, sets }, index) =>
      sets.map(([weightKg, reps, kind = 'work'], order): WorkoutSet => ({
        id: `s${nextId++}`,
        workoutId: id,
        exerciseId,
        date,
        entry: entry ?? index,
        order,
        kind,
        weightKg,
        reps,
        done: true,
      })),
    ),
  );
}

const bench = (...sets: Plan['sets']): Plan => ({ exerciseId: BENCH, sets });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('workoutMinutes', () => {
  const minute = 60000;

  it('counts from start to finish', () => {
    expect(workoutMinutes({ startedAt: 0, finishedAt: 52 * minute })).toBe(52);
  });

  it('knows nothing about a workout with no times, such as an imported one', () => {
    expect(workoutMinutes({})).toBeNull();
    expect(workoutMinutes({ startedAt: 0 })).toBeNull();
  });

  it('leaves out a time that can’t be right', () => {
    expect(workoutMinutes({ startedAt: 0, finishedAt: 20 * 60 * minute })).toBeNull();
    expect(workoutMinutes({ startedAt: 0, finishedAt: 45_000 })).toBeNull();
    expect(workoutMinutes({ startedAt: 5 * minute, finishedAt: 0 })).toBeNull();
  });
});

describe('fmtMinutes', () => {
  it('reads as minutes, hours or both', () => {
    expect(fmtMinutes(52)).toBe('52 min');
    expect(fmtMinutes(60)).toBe('1:00 h');
    expect(fmtMinutes(72)).toBe('1:12 h');
  });
});

describe('loadWorkoutSummary', () => {
  it('is only for finished workouts', async () => {
    await workout('open', '2026-03-01', [bench([60, 8])], 'active');
    expect(await loadWorkoutSummary('open')).toBeNull();
    expect(await loadWorkoutSummary('missing')).toBeNull();
  });

  it('counts work sets, not warm-ups', async () => {
    await workout('w', '2026-03-01', [bench([20, 10, 'warmup'], [60, 8], [60, 8])]);
    expect((await loadWorkoutSummary('w'))?.workSets).toBe(2);
  });

  it('says when an exercise is new', async () => {
    await workout('w', '2026-03-01', [bench([60, 8])]);
    const [row] = (await loadWorkoutSummary('w'))!.exercises;
    expect(row).toMatchObject({ first: true, comparison: null });
  });

  it('compares with the session before', async () => {
    await workout('a', '2026-03-01', [bench([60, 8], [60, 8])]);
    await workout('b', '2026-03-08', [bench([65, 8], [65, 8])]);
    const [row] = (await loadWorkoutSummary('b'))!.exercises;
    expect(row.first).toBe(false);
    expect(row.comparison?.trend).toBe('up');
    expect(row.comparison?.percent).toBeGreaterThan(0);
  });

  it('ignores later sessions when an old workout is opened again', async () => {
    await workout('a', '2026-03-01', [bench([60, 8])]);
    await workout('b', '2026-03-08', [bench([65, 8])]);
    await workout('c', '2026-03-15', [bench([70, 8])]);
    const summary = (await loadWorkoutSummary('b'))!;
    expect(summary.exercises[0].comparison?.trend).toBe('up');
    expect(summary.bests.map((b) => b.workoutId)).toEqual(['b']);
  });

  it('reads a tagged off day as expected, not down', async () => {
    await workout('a', '2026-03-01', [bench([60, 8])]);
    await workout('b', '2026-03-08', [bench([50, 8])]);
    const note: ExerciseNote = { id: 'n', workoutId: 'b', exerciseId: BENCH, date: '2026-03-08', tags: ['tired'] };
    await db.exerciseNotes.add(note);
    const [row] = (await loadWorkoutSummary('b'))!.exercises;
    expect(row).toMatchObject({ offDay: true });
    expect(row.comparison?.trend).toBe('expected');
  });

  it('lists only the bests this workout set', async () => {
    await workout('a', '2026-03-01', [bench([60, 8]), { exerciseId: SQUAT, sets: [[80, 8]] }]);
    await workout('b', '2026-03-08', [bench([70, 8]), { exerciseId: SQUAT, sets: [[80, 8]] }]);
    await workout('c', '2026-03-15', [bench([60, 8]), { exerciseId: SQUAT, sets: [[90, 8]] }]);
    expect((await loadWorkoutSummary('b'))!.bests.map((b) => b.exercise.id)).toEqual([BENCH]);
    expect((await loadWorkoutSummary('c'))!.bests.map((b) => b.exercise.id)).toEqual([SQUAT]);
  });

  it('has no best on a first session, with nothing to beat', async () => {
    await workout('w', '2026-03-01', [bench([100, 8])]);
    expect((await loadWorkoutSummary('w'))!.bests).toEqual([]);
  });

  it('reads an exercise done twice card by card, as the logger does', async () => {
    await workout('a', '2026-03-01', [bench([60, 8], [60, 8], [60, 8], [60, 8])]);
    await workout('w', '2026-03-08', [bench([65, 8], [65, 8]), { exerciseId: SQUAT, sets: [[80, 8]] }, bench([40, 12], [40, 12])]);
    const { exercises, workSets } = (await loadWorkoutSummary('w'))!;
    expect(exercises.map((e) => e.exerciseId)).toEqual([BENCH, SQUAT, BENCH]);
    expect(exercises[0].comparison?.trend).toBe('up');
    expect(exercises[2].comparison?.trend).toBe('down');
    expect(workSets).toBe(5);
  });

  it('compares nothing across a machine or gym change', async () => {
    await workout('a', '2026-03-01', [bench([100, 8])]);
    await db.baselines.add({ id: 'b', exerciseId: BENCH, date: '2026-03-05' });
    await workout('b', '2026-03-08', [bench([60, 8])]);
    const [row] = (await loadWorkoutSummary('b'))!.exercises;
    expect(row).toMatchObject({ restarted: true, first: false, comparison: null });
  });

  it('leaves out a set that wasn’t done', async () => {
    await workout('a', '2026-03-01', [bench([60, 8], [60, 8], [60, 8])]);
    await workout('b', '2026-03-08', [bench([60, 8], [60, 8], [60, 8])]);
    const [extra] = await db.sets.where('workoutId').equals('b').toArray();
    await db.sets.update(extra.id, { done: false, reps: 1 });
    const { workSets, exercises } = (await loadWorkoutSummary('b'))!;
    expect(workSets).toBe(2);
    expect(exercises[0].comparison?.trend).toBe('same');
  });

  it('still compares an exercise that no longer exists', async () => {
    await workout('a', '2026-03-01', [{ exerciseId: 'custom-gone', sets: [[10, 10]] }]);
    await workout('b', '2026-03-08', [{ exerciseId: 'custom-gone', sets: [[20, 10]] }]);
    const [row] = (await loadWorkoutSummary('b'))!.exercises;
    expect(row).toMatchObject({ exerciseId: 'custom-gone', exercise: undefined, first: false });
    expect(row.comparison?.trend).toBe('up');
  });

  it('reads the whole history once, however many exercises there are', async () => {
    const names = [BENCH, SQUAT, 'leg-press', 'pull-up'];
    await workout('w', '2026-03-01', names.map((exerciseId) => ({ exerciseId, sets: [[10, 10]] })));
    await loadWorkoutSummary('w'); // What's learned from the whole history is kept for next time.
    const toArray = vi.spyOn(db.sets, 'toArray');
    await loadWorkoutSummary('w');
    expect(toArray).toHaveBeenCalledTimes(1);
    toArray.mockRestore();
  });
});

describe('compareExercise', () => {
  it('doesn’t read more reps as progress on a timed exercise', () => {
    const set = (reps: number): SessionSet => ({ kind: 'work', weightKg: 0, reps, seconds: 60 });
    const options = { position: 1, previousPosition: 1, cost: 0, load: 'time' as const, bodyKg: 75 };
    expect(compareExercise([set(2)], [set(1)], options)?.trend).toBe('same');
  });
});
