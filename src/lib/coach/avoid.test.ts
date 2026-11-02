import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog/exercises';
import { regionsOf } from '../catalog/regions';
import { toISODate } from '../dates';
import { db } from '../db/schema';
import type { BodyRegion, Exercise, RegionGoal, WorkoutSet } from '../types';
import { avoidedExercises, loadNextWorkout, loadProgress } from './data';
import { planNextType, type NextPick, type RotationWorkout } from './next';

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

const CHEST = ['barbell-bench-press', 'incline-dumbbell-press', 'machine-chest-press', 'pec-deck', 'cable-crossover'];
const LEGS = ['barbell-squat', 'leg-press', 'lying-leg-curl', 'leg-extension', 'seated-leg-curl'];

/** Legs, chest, legs, chest, all over a week ago, so legs come up today. */
const alternating = (legs: string[] = LEGS): RotationWorkout[] => [20, 18, 16, 14, 12, 10].map((daysAgo, i) => on(daysAgo, i % 2 ? CHEST : legs));

const plan = (workouts: RotationWorkout[], avoid: string[], goals: Goals = {}, pick: NextPick = {}) =>
  planNextType(workouts, exercises, pace, pick, goals, new Set(avoid));

describe('an avoided main lift', () => {
  const smithDay = ['smith-squat', ...LEGS.slice(1)];

  it('gives its place to what the user does, and says so', () => {
    const next = plan([on(40, smithDay), ...alternating()], ['barbell-squat'])!;
    expect(next.exerciseIds).toEqual(smithDay);
    expect(next.standIns).toEqual([{ exerciseId: 'smith-squat', instead: 'barbell-squat', fresh: false }]);
  });

  it('gives it to something new when the user has nothing like it', () => {
    const next = plan(alternating(['barbell-squat', 'lying-leg-curl', 'seated-leg-curl']), ['barbell-squat'])!;
    expect(next.exerciseIds[0]).toBe(next.standIns[0].exerciseId);
    expect(next.standIns[0]).toMatchObject({ instead: 'barbell-squat', fresh: true });
    expect(exercises.get(next.exerciseIds[0])!.equipment).not.toBe('barbell');
  });

  it('makes the stand-in a main lift, which a goal can’t take away', () => {
    const days = [...alternating(), on(2, smithDay, 20)];
    const next = plan(days, ['barbell-squat'], { quads: 'maintain' }, { type: 'legs' })!;
    expect(next.exerciseIds[0]).toBe('smith-squat');
    expect(next.leftOut).toContain('leg-extension');
  });

  it('never comes back through the pool', () => {
    const next = plan([on(40, smithDay), ...alternating(['leg-press', 'barbell-squat', 'lying-leg-curl'])], ['smith-squat', 'barbell-squat'])!;
    expect(next.exerciseIds).not.toContain('smith-squat');
    expect(next.exerciseIds).not.toContain('barbell-squat');
  });
});

describe('an avoided filler', () => {
  const day = ['barbell-squat', 'lying-leg-curl', 'leg-extension', 'seated-leg-curl', 'leg-press'];

  it('gets a stand-in in its slot', () => {
    const next = plan([on(40, ['hack-squat']), ...alternating(day)], ['leg-press'])!;
    expect(next.exerciseIds).toEqual([...day.slice(0, 4), 'hack-squat']);
    expect(next.standIns).toEqual([{ exerciseId: 'hack-squat', instead: 'leg-press', fresh: false }]);
  });

  it('goes when nothing can stand in, without a crash', () => {
    const next = plan(alternating(), ['leg-extension'])!;
    expect(next.exerciseIds).toEqual(LEGS.filter((id) => id !== 'leg-extension'));
    expect(next.standIns).toEqual([]);
  });

  it('doesn’t let a stand-in rotate into a second slot', () => {
    const older = ['barbell-squat', 'lying-leg-curl', 'leg-extension', 'hack-squat', 'seated-leg-curl'];
    const next = plan([on(40, older), on(30, older), ...alternating(day)], ['leg-press'])!;
    expect(new Set(next.exerciseIds).size).toBe(next.exerciseIds.length);
    expect(next.standIns.map((s) => s.exerciseId)).toEqual(['hack-squat']);
  });

  it('doesn’t report a stand-in that fitting the week took out', () => {
    const days = [on(40, ['hack-squat']), ...alternating(day), on(2, day, 20)];
    const next = plan(days, ['leg-press'], { quads: 'maintain' }, { type: 'legs' })!;
    expect(next.exerciseIds).not.toContain('hack-squat');
    expect(next.standIns).toEqual([]);
    expect(next.leftOut).toContain('hack-squat');
  });

  it('doesn’t call a new stand-in left out, since the user never did it', () => {
    const days = [...alternating(day), on(2, day, 20)];
    const pick = plan(alternating(day), ['leg-press'])!.standIns[0];
    expect(pick.fresh).toBe(true);
    const next = plan(days, ['leg-press'], { quads: 'maintain' }, { type: 'legs' })!;
    expect(next.exerciseIds).not.toContain(pick.exerciseId);
    expect(next.standIns).toEqual([]);
    expect(next.leftOut).toEqual([]);
  });

  it('reports a focus as an addition when it took the place of a new stand-in', () => {
    const history = alternating(day);
    const { exerciseId } = plan(history, ['leg-press'])!.standIns[0];
    const next = plan(history, ['leg-press'], { sideDelts: 'focus', rearDelts: 'focus' })!;
    expect(next.exerciseIds).not.toContain(exerciseId);
    expect(next.focus).toHaveLength(2);
    expect(next.focus.flatMap((pick) => pick.replaced ?? [])).toEqual([]);
    expect(next.standIns).toEqual([]);
  });

  it('drops the muscle in common along with a new stand-in a focus took the place of', () => {
    const history = [on(40, ['bulgarian-split-squat']), ...alternating(day)];
    const { exerciseId } = plan(history, ['leg-press'])!.standIns[0];
    const next = plan(history, ['leg-press'], { glutes: 'focus' })!;
    expect(next.exerciseIds).not.toContain(exerciseId);
    expect(next.focus).toEqual([{ exerciseId: 'bulgarian-split-squat', region: 'glutes', fresh: false }]);
  });

  it('still names a stand-in the user knows when a focus took its place', () => {
    const history = [on(40, ['hack-squat']), ...alternating(day)];
    const next = plan(history, ['leg-press'], { sideDelts: 'focus', rearDelts: 'focus' })!;
    expect(next.focus.flatMap((pick) => pick.replaced ?? [])).toEqual(['hack-squat']);
    expect(next.standIns).toEqual([]);
  });

  it('finds a stand-in from before the rotation’s window, and knows it isn’t new', () => {
    const recent = Array.from({ length: 32 }, (_, i) => on(100 - 3 * i, i % 2 ? CHEST : LEGS));
    const next = plan([on(200, ['smith-squat', ...LEGS.slice(1)]), ...recent], ['barbell-squat'])!;
    expect(next.key).toBe('legs');
    expect(next.standIns).toEqual([{ exerciseId: 'smith-squat', instead: 'barbell-squat', fresh: false }]);
  });
});

describe('a Focus goal', () => {
  const goals: Goals = { sideDelts: 'focus' };

  it('doesn’t bring in as new what the user doesn’t want', () => {
    const first = plan(alternating(), [], goals)!.focus[0];
    expect(first.fresh).toBe(true);
    const next = plan(alternating(), [first.exerciseId], goals)!;
    expect(next.exerciseIds).not.toContain(first.exerciseId);
    expect(next.focus[0].exerciseId).not.toBe(first.exerciseId);
  });

  it('doesn’t bring it back when the user has done it', () => {
    const history = [on(40, ['lateral-raise']), ...alternating()];
    expect(plan(history, [], goals)!.focus[0].exerciseId).toBe('lateral-raise');
    expect(plan(history, ['lateral-raise'], goals)!.exerciseIds).not.toContain('lateral-raise');
  });

  it('adds nothing when all of it is avoided', () => {
    const all = CATALOG.filter((e) => regionsOf(e).main.includes('sideDelts')).map((e) => e.id);
    expect(plan(alternating(), all, goals)!.focus).toEqual([]);
  });
});

describe('an avoided variant lead', () => {
  const A = ['barbell-squat', 'lying-leg-curl', 'leg-extension'];
  const B = ['romanian-deadlift', 'seated-leg-curl', 'standing-calf-raise'];
  /** Legs days with chest between, so the rotation lands on legs. */
  const days = (...legs: string[][]): RotationWorkout[] => {
    const start = 3 * legs.length + 3;
    return legs.flatMap((day, i) => [on(start - 3 * i, day), on(start - 3 * i - 1, CHEST)]);
  };
  const withSmith = (...legs: string[][]) => [on(60, ['smith-squat', 'hip-abductor', 'hip-adductor']), ...days(...legs)];

  it('names the stand-in in the reason, and leaves the past as it was', () => {
    const next = plan(withSmith(A, B, A, B), ['barbell-squat'])!;
    expect(next.exerciseIds).toEqual(['smith-squat', ...A.slice(1)]);
    expect(next.reason).toEqual({ kind: 'alternate', after: 'romanian-deadlift', lead: 'smith-squat' });
  });

  it('offers no chip for it', () => {
    expect(plan(withSmith(A, B, A, B, A), [])!.otherLeads).toContain('barbell-squat');
    expect(plan(withSmith(A, B, A, B, A), ['barbell-squat'])!.otherLeads).not.toContain('barbell-squat');
  });

  it('offers no chip for what leads today', () => {
    expect(plan(withSmith(A, B, A, B), ['barbell-squat'])!.otherLeads).toEqual(['romanian-deadlift']);
  });

  it('still alternates by what happened', () => {
    expect(plan(withSmith(A, B, A, B, A), ['barbell-squat'])!.exerciseIds).toEqual(B);
    expect(plan(withSmith(A, B, A, B, A, B), ['barbell-squat'])!.exerciseIds[0]).toBe('smith-squat');
  });

  it('gives no reason when the stand-in is what led last time', () => {
    const C = ['smith-squat', 'seated-leg-curl', 'standing-calf-raise'];
    const next = plan(days(A, C, A, C), ['barbell-squat'])!;
    expect(next.exerciseIds[0]).toBe('smith-squat');
    expect(next.reason).toBeNull();
  });

  it('doesn’t say a stand-in usually comes next', () => {
    const history = withSmith(B, A, A, B, A);
    expect(plan(history, [])!.reason).toMatchObject({ kind: 'again', lead: 'barbell-squat' });
    const next = plan(history, ['barbell-squat'])!;
    expect(next.exerciseIds[0]).toBe('smith-squat');
    expect(next.reason).toBeNull();
  });

  it('keeps a late stand-in as the main lift it replaced, so the week can’t take it out', () => {
    const late = ['crunch', 'wrist-curl', 'lateral-raise', 'barbell-squat', 'lying-leg-curl'];
    const history = [...withSmith(late, B, late, B), on(1, ['leg-extension'], 20)];
    const next = plan(history, ['barbell-squat'], { quads: 'maintain' }, { type: 'legs', lead: 'barbell-squat' })!;
    expect(next.exerciseIds).toContain('smith-squat');
    expect(next.leftOut).not.toContain('smith-squat');
  });

  it('gives no reason when nothing can stand in', () => {
    const lonely = ['leg-extension', 'lying-leg-curl', 'seated-leg-curl'];
    const next = plan(days(lonely, B, lonely, B), ['leg-extension'])!;
    expect(next.exerciseIds).toEqual(lonely.slice(1));
    expect(next.reason).toBeNull();
    expect(next.otherLeads).toEqual(['romanian-deadlift']);
  });

  it('keeps a stand-in out of the reason when it isn’t in the plan', () => {
    const warmUp = ['crunch', 'wrist-curl', 'lateral-raise'];
    const late = (filler: string) => [...warmUp, 'barbell-squat', filler];
    const next = plan(withSmith(late('lying-leg-curl'), B, late('leg-press'), B), ['barbell-squat'])!;
    expect(next.exerciseIds).not.toContain('smith-squat');
    expect(next.reason).toBeNull();
    expect(next.standIns).toEqual([]);
  });
});

describe('a slot’s own exercise done again on a combined day', () => {
  const combined = ['barbell-squat', 'seated-leg-curl', 'barbell-bench-press', 'incline-dumbbell-press'];
  const history = [...[27, 24, 21, 18, 15].map((daysAgo, i) => on(daysAgo, i % 2 ? LEGS : CHEST)), on(12, combined), on(9, CHEST)];
  const first = on(40, ['barbell-squat', 'leg-press', 'lying-leg-curl', 'hack-squat', 'seated-leg-curl']);

  it('is planned once with something avoided', () => {
    const { exerciseIds } = plan([first, ...history], ['hack-squat'], {}, { type: 'legs' })!;
    expect(exerciseIds).toContain('seated-leg-curl');
    expect(new Set(exerciseIds).size).toBe(exerciseIds.length);
  });

  it('is planned once with nothing avoided', () => {
    const { exerciseIds } = plan(history, [], {}, { type: 'legs' })!;
    expect(exerciseIds).toContain('seated-leg-curl');
    expect(new Set(exerciseIds).size).toBe(exerciseIds.length);
  });
});

describe('a type with nothing left', () => {
  const CARDIO = ['treadmill'];
  const LONELY = ['leg-extension', 'wall-sit', 'hip-adductor'];
  const OTHER = ['smith-squat', 'lying-leg-curl', 'seated-leg-curl'];
  const inTurn = (...list: string[][]) => list.map((day, i) => on(3 * (list.length - i) + 7, day));
  const cardioNext = inTurn(CHEST, CARDIO, CHEST, CARDIO, CHEST);

  it('gives way to a type that has something, with no reason of the rotation’s', () => {
    expect(plan(cardioNext, [])).toMatchObject({ key: 'cardio', otherTypes: ['chest'] });
    expect(plan(cardioNext, [])!.typeReason).not.toBeNull();
    const next = plan(cardioNext, ['treadmill'])!;
    expect(next).toMatchObject({ key: 'chest', exerciseIds: CHEST, typeReason: null, otherTypes: [] });
  });

  it('goes by the order of the other types', () => {
    const history = inTurn(CHEST, LEGS, CARDIO, CHEST, LEGS, CARDIO, CHEST, LEGS);
    const usual = plan(history, [])!;
    expect(usual.key).toBe('cardio');
    expect(usual.otherTypes).toHaveLength(2);
    const next = plan(history, ['treadmill'])!;
    expect(next.key).toBe(usual.otherTypes[0]);
    expect(next.otherTypes).toEqual([usual.otherTypes[1]]);
  });

  it('skips a type that has nothing left either', () => {
    const history = inTurn(CHEST, LONELY, CARDIO, CHEST, LONELY, CARDIO, CHEST, LONELY);
    expect(plan(history, ['treadmill', ...LONELY])).toMatchObject({ key: 'chest', otherTypes: [] });
  });

  it('offers no chip for it', () => {
    const chestNext = inTurn(CHEST, CARDIO, CHEST, CARDIO);
    expect(plan(chestNext, [])).toMatchObject({ key: 'chest', otherTypes: ['cardio'] });
    expect(plan(chestNext, ['treadmill'])).toMatchObject({ key: 'chest', otherTypes: [] });
  });

  it('can still come back null when picked', () => {
    expect(plan(cardioNext, ['treadmill'], {}, { type: 'cardio' })).toBeNull();
  });

  it('keeps a lead chip working on the card that took over', () => {
    const INCLINE = ['incline-barbell-press', 'pec-deck', 'cable-crossover'];
    const history = inTurn(CHEST, CARDIO, INCLINE, CARDIO, CHEST, CARDIO, INCLINE, CARDIO, CHEST);
    const card = plan(history, ['treadmill'])!;
    expect(card).toMatchObject({ key: 'chest', otherLeads: ['barbell-bench-press'] });
    const tapped = plan(history, ['treadmill'], {}, { lead: 'barbell-bench-press' })!;
    expect(tapped.key).toBe('chest');
    expect(tapped.exerciseIds[0]).toBe('barbell-bench-press');
  });

  it('gives way to another variant of the type first', () => {
    const history = inTurn(LONELY, OTHER, LONELY, OTHER);
    expect(plan(history, [])!.exerciseIds[0]).toBe('leg-extension');
    const next = plan(history, LONELY)!;
    expect(next.key).toBe('legs');
    expect(next.exerciseIds).toEqual(OTHER);
    expect(next.reason).toBeNull();
  });

  it('keeps the chip of a type whose other variant has something', () => {
    const history = inTurn(LONELY, CHEST, OTHER, CHEST, LONELY, CHEST, OTHER);
    const next = plan(history, LONELY)!;
    expect(next).toMatchObject({ key: 'chest', otherTypes: ['legs'] });
    expect(plan(history, LONELY, {}, { type: 'legs' })!.exerciseIds).toEqual(OTHER);
  });

  it('never offers a chip that comes back null', () => {
    const history = inTurn(CHEST, CARDIO, LEGS, CHEST, CARDIO, LEGS, CHEST, CARDIO);
    const next = plan(history, ['treadmill', 'barbell-bench-press'])!;
    for (const type of next.otherTypes) expect(plan(history, ['treadmill', 'barbell-bench-press'], {}, { type })).not.toBeNull();
    for (const lead of next.otherLeads) expect(plan(history, ['treadmill', 'barbell-bench-press'], {}, { lead })).not.toBeNull();
  });
});

describe('a partner muscle', () => {
  const day = (shoulders: string) => ['leg-press', 'lying-leg-curl', 'seated-leg-curl', shoulders];

  it('doesn’t come back through an avoided exercise', () => {
    const history = [20, 18, 16, 14, 12, 10].map((daysAgo, i) => on(daysAgo, i % 2 ? CHEST : i === 4 ? day('leg-extension') : day('lateral-raise')));
    expect(plan(history, ['lateral-raise'])!.exerciseIds).not.toContain('lateral-raise');
  });
});

describe('a borrowed exercise', () => {
  const chest = CHEST.slice(0, 3);
  const back = ['barbell-row', 'lat-pulldown', 'seated-cable-row'];
  const everyOther = (w: number) => (w % 2 ? [] : ['wrist-curl']);
  const history = (filler: string): RotationWorkout[] =>
    [7, 6, 5, 4, 3, 2, 1, 0].flatMap((w) => [on(7 * w + 6, [...chest, ...everyOther(w)]), on(7 * w + 3, w % 2 ? [...back, filler] : back)]);

  it('isn’t brought in when avoided', () => {
    expect(plan(history('crunch'), [])!.exerciseIds).toContain('crunch');
    expect(plan(history('crunch'), ['crunch'])!.exerciseIds).not.toContain('crunch');
  });
});

describe('two avoided exercises', () => {
  it('don’t get the same stand-in', () => {
    const day = ['barbell-squat', 'front-squat', 'lying-leg-curl'];
    const next = plan([on(40, ['smith-squat']), ...alternating(day)], ['barbell-squat', 'front-squat'])!;
    expect(next.standIns.map((s) => s.instead)).toEqual(day.slice(0, 2));
    expect(next.standIns[0]).toMatchObject({ exerciseId: 'smith-squat', fresh: false });
    expect(next.standIns[1].exerciseId).not.toBe('smith-squat');
    expect(new Set(next.exerciseIds).size).toBe(next.exerciseIds.length);
  });
});

describe('with everything avoided', () => {
  it('plans nothing rather than an empty workout', () => {
    expect(plan(alternating(), [...exercises.keys()])).toBeNull();
  });

  it('plans nothing when a type’s only exercise has no stand-in', () => {
    expect(plan([on(5, ['leg-extension']), on(3, ['leg-extension'])], ['leg-extension'])).toBeNull();
  });
});

describe('with nothing avoided', () => {
  const history = [on(40, ['lateral-raise']), ...alternating()];

  it('plans just as before', () => {
    const goals: Goals = { sideDelts: 'focus' };
    expect(plan(history, [], goals)).toEqual(planNextType(history, exercises, pace, {}, goals));
    expect(plan(history, [])?.standIns).toEqual([]);
    expect(plan(history, ['wrist-curl'])).toEqual(plan(history, []));
  });
});

describe('the stored setting', () => {
  let nextSet = 0;

  async function finished(id: string, date: string, exerciseIds: string[]) {
    await db.workouts.add({ id, date, status: 'done', source: 'app', updatedAt: 1 });
    await db.sets.bulkAdd(
      exerciseIds.map((exerciseId, entry): WorkoutSet => ({ id: `s${nextSet++}`, workoutId: id, exerciseId, date, entry, order: 0, kind: 'work', weightKg: 50, reps: 8, done: true })),
    );
  }

  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('lists what still exists, and only what’s avoided', async () => {
    await db.exerciseSettings.bulkPut([
      { exerciseId: 'barbell-squat', avoid: true },
      { exerciseId: 'gone', avoid: true },
      { exerciseId: 'leg-press', avoid: false },
      { exerciseId: 'lying-leg-curl', goal: 'maintain' },
    ]);
    expect((await avoidedExercises()).map((e) => e.id)).toEqual(['barbell-squat']);
  });

  it('counts a user’s own exercise', async () => {
    await db.customExercises.add({ ...exercises.get('leg-press')!, id: 'custom-1', createdAt: 1 });
    await db.exerciseSettings.put({ exerciseId: 'custom-1', avoid: true });
    expect((await avoidedExercises()).map((e) => e.id)).toEqual(['custom-1']);
  });

  it('reaches the next workout, with both exercises in full', async () => {
    await finished('a', '2026-01-01', ['smith-squat', 'lying-leg-curl']);
    await finished('b', '2026-01-03', CHEST);
    await finished('c', '2026-01-05', LEGS);
    await finished('d', '2026-01-07', CHEST);
    await finished('e', '2026-01-09', LEGS);
    await finished('f', '2026-01-11', CHEST);
    await db.exerciseSettings.put({ exerciseId: 'barbell-squat', avoid: true });
    const next = await loadNextWorkout();
    expect(next?.exercises.map((e) => e.exercise.id)).toContain('smith-squat');
    expect(next?.exercises.map((e) => e.exercise.id)).not.toContain('barbell-squat');
    expect(next?.standIns).toEqual([{ exercise: exercises.get('smith-squat'), instead: exercises.get('barbell-squat'), fresh: false }]);
  });

  it('leaves it out of what the body map offers, but not out of what was done', async () => {
    await finished('a', toISODate(), ['barbell-squat']);
    await db.exerciseSettings.bulkPut([
      { exerciseId: 'barbell-squat', avoid: true },
      { exerciseId: 'smith-squat', avoid: true },
    ]);
    const { body } = await loadProgress();
    const quads = body.regions.find((row) => row.region === 'quads')!;
    expect(quads.others.map((e) => e.id)).not.toContain('smith-squat');
    expect(quads.others.map((e) => e.id)).toContain('hack-squat');
    expect(quads.shares.map((share) => share.exercise.id)).toEqual(['barbell-squat']);
  });
});
