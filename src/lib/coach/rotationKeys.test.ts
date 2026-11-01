import { describe, expect, it } from 'vitest';
import type { Exercise, Muscle } from '../types';
import { nextKey, overdueKey, planNextType, rotationKeys, rotationTypeCount, type RotationWorkout } from './next';

const ex = (id: string, muscle: Muscle, helpers?: Muscle[]): Exercise => ({
  id,
  names: { en: id, de: id, ru: id },
  muscle,
  equipment: 'barbell',
  load: 'weight',
  compound: true,
  helpers,
});

const exercises = new Map(
  [
    ex('bench', 'chest', ['triceps', 'shoulders']),
    ex('incline', 'chest', ['triceps', 'shoulders']),
    ex('flyes', 'chest'),
    ex('row', 'back', ['biceps']),
    ex('pull', 'back', ['biceps']),
    ex('pulldown', 'back', ['biceps']),
    ex('squat', 'legs', ['glutes']),
    ex('legPress', 'legs', ['glutes']),
    ex('legCurl', 'legs'),
    ex('legExtension', 'legs'),
    ex('deadlift', 'back', ['legs', 'glutes', 'forearms']),
    ex('overhead', 'shoulders', ['triceps']),
    ex('lateral', 'shoulders'),
    ex('facePull', 'shoulders', ['back']),
    ex('pushdown', 'triceps'),
    ex('dips', 'triceps', ['chest', 'shoulders']),
    ex('extension', 'triceps'),
    ex('curl', 'biceps'),
    ex('hammer', 'biceps'),
    ex('crunch', 'abs'),
    ex('wrist', 'forearms'),
  ].map((e) => [e.id, e]),
);

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function day(sets: Record<string, number>, date = '2026-01-01', id = date): RotationWorkout {
  return { id, date, exerciseIds: Object.keys(sets), workSets: sets };
}

const keysOf = (sets: Record<string, number>) => rotationKeys([day(sets)], exercises);

/** Workouts `gap` days apart, ending on `last`. */
function series(days: Record<string, number>[], last = '2026-02-28', gap = 2): RotationWorkout[] {
  return days.map((sets, i) => {
    const d = new Date(`${last}T12:00:00`);
    d.setDate(d.getDate() - (days.length - 1 - i) * gap);
    return day(sets, isoOf(d));
  });
}

const CHEST = { bench: 3, incline: 3, flyes: 3 };
const BACK = { row: 3, pull: 3, pulldown: 3 };
const LEGS = { squat: 3, legPress: 3, legCurl: 3 };
const BACK_LEGS = { row: 3, pull: 3, squat: 3, legPress: 3 };
const LEGS_BACK = { squat: 3, legPress: 3, row: 3, pull: 3 };
const CHEST_BACK = { bench: 3, incline: 3, row: 3 };
const BACK_CHEST = { row: 3, pull: 3, bench: 3 };
const LEGS_SHOULDERS = { squat: 3, legPress: 3, overhead: 3, lateral: 3 };
const BACK_BICEPS = { row: 3, pull: 3, curl: 3, hammer: 3 };
const CHEST_TRICEPS = { bench: 3, incline: 3, pushdown: 3, extension: 3 };

/** Legs and shoulders, back and biceps, chest and triceps, in turn. */
const split = (count: number) => Array.from({ length: count }, (_, i) => [LEGS_SHOULDERS, BACK_BICEPS, CHEST_TRICEPS][i % 3]);
const repeat = <T>(count: number, days: T[]): T[] => Array.from({ length: count }, () => days).flat();

describe('what a workout counts as', () => {
  it('counts a combined day as both, in the order they first appear', () => {
    expect(keysOf(BACK_LEGS)).toEqual(['back', 'legs']);
    expect(keysOf(LEGS_BACK)).toEqual(['legs', 'back']);
    expect(keysOf({ row: 6, bench: 6 })).toEqual(['back', 'chest']);
  });

  it('expands a combined day in place', () => {
    const list = series([CHEST, BACK_LEGS, CHEST]);
    expect(rotationKeys(list, exercises)).toEqual(['chest', 'back', 'legs', 'chest']);
  });

  it('counts the legs in a deadlift as its sets dictate', () => {
    // 6 deadlift sets also give 6 for legs and glutes; back is a third of 18, so it counts too.
    expect(keysOf({ deadlift: 6, squat: 4 })).toEqual(['back', 'legs']);
    expect(keysOf({ deadlift: 4, squat: 6, legPress: 4 })).toEqual(['legs']);
    expect(keysOf({ deadlift: 3, row: 4, pull: 4 })).toEqual(['back']);
  });

  it('keeps a chest day with triceps as chest', () => {
    expect(keysOf({ bench: 5, incline: 4, pushdown: 6 })).toEqual(['chest']);
  });

  it('keeps legs and shoulders as legs', () => {
    expect(keysOf({ squat: 6, legPress: 6, overhead: 6, lateral: 6 })).toEqual(['legs']);
  });

  it('falls back to the leading group with none of chest, back and legs', () => {
    expect(keysOf({ overhead: 6, lateral: 6 })).toEqual(['shoulders']);
    expect(keysOf({ pushdown: 6, curl: 6 })).toEqual(['arms']);
  });

  it('does not make a type from helping alone', () => {
    expect(keysOf({ pushdown: 6, dips: 6, curl: 6 })).toEqual(['arms']);
    expect(keysOf({ facePull: 6, lateral: 6 })).toEqual(['shoulders']);
  });

  it('counts a group at exactly a third', () => {
    expect(keysOf({ row: 4, pulldown: 4, legCurl: 4 })).toEqual(['back', 'legs']);
    expect(keysOf({ flyes: 4, row: 4, legCurl: 4 })).toEqual(['chest', 'back', 'legs']);
  });

  it('leaves a group under a third out', () => {
    expect(keysOf({ row: 5, pulldown: 5, legCurl: 4 })).toEqual(['back']);
  });

  it('keeps one empty key for a workout with no known exercises', () => {
    expect(keysOf({ gone: 4 })).toEqual(['']);
  });
});

describe('a combined day in the rotation', () => {
  const rotation = [CHEST, BACK, LEGS, CHEST, BACK, LEGS];

  it('carries the rotation on past it', () => {
    expect(planNextType(series([...rotation, CHEST, BACK_LEGS]), exercises)?.key).toBe('chest');
    expect(planNextType(series([...rotation, BACK_LEGS]), exercises)?.key).toBe('chest');
  });

  it('skips the type that was combined in', () => {
    expect(planNextType(series([...rotation, CHEST, BACK]), exercises)?.key).toBe('legs');
    expect(planNextType(series([...rotation, CHEST, BACK, LEGS]), exercises)?.key).toBe('chest');
  });

  it('never offers a combined type', () => {
    const plan = planNextType(series([...rotation, BACK_LEGS, CHEST, BACK_LEGS, CHEST]), exercises)!;
    for (const key of [plan.key, ...plan.otherTypes, ...(plan.typeReason?.types ?? [])]) expect(['chest', 'back', 'legs']).toContain(key);
    expect(plan.otherTypes.length).toBe(2);
  });

  it('gives a plain usual order in the reason', () => {
    const plan = planNextType(series([...rotation, CHEST, BACK_LEGS, CHEST, BACK]), exercises)!;
    expect(plan.key).toBe('legs');
    expect(plan.typeReason).toEqual({ kind: 'usual', types: ['chest', 'back', 'legs'] });
  });

  it('counts both of its types as seen when breaking a tie', () => {
    // Nothing has ever followed back. Legs would be left longest, but the combined day trained them.
    const list = series([LEGS, CHEST, LEGS, CHEST, LEGS_BACK]);
    expect(rotationKeys(list, exercises)).toEqual(['legs', 'chest', 'legs', 'chest', 'legs', 'back']);
    expect(nextKey(rotationKeys(list.slice(0, -1).concat(series([BACK])), exercises))).toBe('legs');
    expect(planNextType(list, exercises)?.key).toBe('chest');
  });

  it('counts for both types in the rotation’s length', () => {
    expect(rotationTypeCount(series([BACK_LEGS, LEGS, BACK]), exercises)).toBe(2);
  });

  it('keeps dates in step, so a combined type is not called overdue', () => {
    // Plain, legs has waited too long. Combining it into the last workout means it hasn't.
    const muscles = { a: CHEST, b: BACK, c: LEGS };
    const order = ['c', 'a', 'b', 'a', 'b', 'a', 'b', 'c', 'a', 'b'] as const;
    const pace = { today: '2026-03-03', perWeek: 3 };
    const plain = series(order.map((k) => muscles[k]), '2026-02-28', 3);
    expect(planNextType(plain, exercises, pace)?.key).toBe('legs');
    const combined = series([...order.slice(0, -1).map((k) => muscles[k]), LEGS_BACK], '2026-02-28', 3);
    expect(rotationKeys(combined, exercises).slice(-2)).toEqual(['legs', 'back']);
    expect(planNextType(combined, exercises, pace)?.key).toBe('chest');
  });

  it('gives each key its day to the overdue check', () => {
    const keys = ['chest', 'back', 'legs', 'chest', 'back', 'legs', 'chest'];
    const dates = ['2026-02-01', '2026-02-01', '2026-02-04', '2026-02-07', '2026-02-07', '2026-02-10', '2026-02-13'];
    expect(overdueKey(keys, dates, { today: '2026-02-15', perWeek: 3 })).toBe('back');
  });
});

describe('planning from a combined day', () => {
  /** Ends on back, so legs comes next; `legs` are the legs days. */
  const withLegs = (legs: Record<string, number>[]) => series(legs.flatMap((d) => [d, CHEST, BACK]));

  it('takes only this type’s exercises from a combined day', () => {
    const plan = planNextType(series([CHEST, BACK_LEGS, CHEST]), exercises)!;
    expect(plan.key).toBe('back');
    expect(plan.exerciseIds).toEqual(['row', 'pull']);
    const legs = planNextType(series([CHEST, BACK_LEGS, CHEST]), exercises, undefined, { type: 'legs' })!;
    expect(legs.exerciseIds).toEqual(['squat', 'legPress']);
  });

  it('keeps fillers from a combined day', () => {
    const combined = { row: 4, pull: 4, squat: 4, legPress: 4, crunch: 3 };
    const plan = planNextType(series([CHEST, combined, CHEST]), exercises, undefined, { type: 'legs' })!;
    expect(plan.exerciseIds).toEqual(['squat', 'legPress', 'crunch']);
  });

  it('prefers a recent full workout of the type', () => {
    const plan = planNextType(withLegs([LEGS, BACK_LEGS]), exercises)!;
    expect(plan.key).toBe('legs');
    expect(plan.exerciseIds.slice(0, 3)).toEqual(['squat', 'legPress', 'legCurl']);
    expect(plan.exerciseIds).not.toContain('row');
  });

  it('leads a variant on the type’s own first exercise', () => {
    const list = series([BACK, LEGS, BACK_LEGS, LEGS, BACK, LEGS_BACK]);
    const plan = planNextType(list, exercises, undefined, { type: 'back' })!;
    expect(plan.otherLeads).toEqual([]);
    expect(plan.exerciseIds[0]).toBe('row');
  });

  it('keeps the whole day when nothing of the type’s own is in it', () => {
    const plan = planNextType(series([{ deadlift: 6 }, CHEST, { deadlift: 6 }, CHEST]), exercises, undefined, { type: 'legs' })!;
    expect(plan.key).toBe('legs');
    expect(plan.exerciseIds).toEqual(['deadlift']);
  });

  it('does not limit the type’s own muscle, and limits the other type’s in a filler', () => {
    const today = '2026-03-02';
    const on = (daysAgo: number, sets: Record<string, number>) => {
      const d = new Date(`${today}T12:00:00`);
      d.setDate(d.getDate() - daysAgo);
      return day(sets, isoOf(d));
    };
    const legDay = { squat: 3, legPress: 3, legCurl: 3, legExtension: 3, wrist: 3 };
    const list: RotationWorkout[] = [];
    for (let week = 7; week >= 0; week--) list.push(on(7 * week + 6, legDay), on(7 * week + 3, BACK_LEGS));
    const plan = planNextType(list, exercises, { today, perWeek: 2 }, { type: 'legs' })!;
    expect(plan.exerciseIds).toEqual(['squat', 'legPress', 'legCurl', 'legExtension']);
    expect(plan.leftOut).toEqual(['wrist']);
  });

  it('counts a combined day’s work in the week', () => {
    const today = '2026-03-02';
    const on = (daysAgo: number, sets: Record<string, number>) => {
      const d = new Date(`${today}T12:00:00`);
      d.setDate(d.getDate() - daysAgo);
      return day(sets, isoOf(d));
    };
    const chestDay = { ...CHEST, wrist: 3 };
    const list: RotationWorkout[] = [];
    for (let week = 7; week >= 1; week--) list.push(on(7 * week + 6, chestDay), on(7 * week + 3, BACK));
    list.push(on(6, CHEST), on(3, { row: 3, pull: 3, squat: 3, legPress: 3, wrist: 3 }));
    const plan = planNextType(list, exercises, { today, perWeek: 2 }, { type: 'chest' })!;
    expect(plan.leftOut).toEqual(['wrist']);
  });
});

describe('groups trained together out of habit', () => {
  it('makes them one type', () => {
    const list = series(repeat(4, [CHEST_BACK]));
    expect(rotationKeys(list, exercises)).toEqual(repeat(4, ['chest+back']));
    expect(rotationTypeCount(list, exercises)).toBe(1);
  });

  it('plans the whole day, and needs no reason with nothing else to choose', () => {
    const plan = planNextType(series(repeat(4, [CHEST_BACK])), exercises)!;
    expect(plan.key).toBe('chest+back');
    expect(plan.exerciseIds).toEqual(['bench', 'incline', 'row']);
    expect(plan.typeReason).toBeNull();
    expect(plan.otherTypes).toEqual([]);
  });

  it('is the same type in either order', () => {
    expect(new Set(rotationKeys(series(repeat(2, [CHEST_BACK, BACK_CHEST])), exercises))).toEqual(new Set(['chest+back']));
  });

  it('rotates with the rest of the split', () => {
    const plan = planNextType(series(repeat(3, [CHEST_BACK, LEGS])), exercises)!;
    expect(plan.key).toBe('chest+back');
    expect(plan.typeReason?.types).toEqual(['chest+back', 'legs', 'chest+back']);
    const after = planNextType(series([...repeat(3, [CHEST_BACK, LEGS]), CHEST_BACK]), exercises)!;
    expect(after.key).toBe('legs');
    expect(after.otherTypes).toEqual(['chest+back']);
  });

  it('leaves other types out of the day’s plan', () => {
    const allThree = { flyes: 3, row: 3, legCurl: 3 };
    const list = series([...repeat(3, [CHEST_BACK, LEGS]), allThree]);
    expect(rotationKeys(list, exercises).slice(-2)).toEqual(['chest+back', 'legs']);
    const plan = planNextType(list, exercises, undefined, { type: 'chest+back' })!;
    expect(plan.exerciseIds).not.toContain('legCurl');
  });

  it('needs more than half the days', () => {
    expect(rotationKeys(series([CHEST_BACK, CHEST_BACK, CHEST, BACK]), exercises).slice(0, 2)).toEqual(['chest', 'back']);
  });

  it('needs more than one day', () => {
    expect(rotationKeys(series([CHEST_BACK]), exercises)).toEqual(['chest', 'back']);
  });

  it('does not pair a group that only helped', () => {
    expect(rotationKeys(series(repeat(3, [{ deadlift: 6 }])), exercises)).toEqual(repeat(3, ['back', 'legs']));
  });

  it('follows a change to a combined split, without the old types', () => {
    const list = series([...repeat(8, [CHEST, BACK]), ...repeat(12, [CHEST_BACK])]);
    expect(new Set(rotationKeys(list, exercises))).toEqual(new Set(['chest+back']));
    expect(planNextType(list, exercises)?.exerciseIds).toEqual(['bench', 'incline', 'row']);
  });

  it('lets go of a split that ended', () => {
    const list = series([...repeat(6, [CHEST_BACK]), ...repeat(6, [CHEST, BACK])]);
    expect(new Set(rotationKeys(list, exercises))).toEqual(new Set(['chest', 'back']));
  });
});

describe('muscles a type’s days usually train', () => {
  const after = { today: '2026-03-02', perWeek: 3 };

  it('are named per type, from any split', () => {
    expect(planNextType(series(split(9)), exercises)?.partners).toEqual({ legs: ['shoulders'], back: ['biceps'], chest: ['triceps'] });
  });

  it('start with the second day', () => {
    expect(planNextType(series(split(3)), exercises)?.partners).toEqual({ legs: [], back: [], chest: [] });
    expect(planNextType(series(split(6)), exercises)?.partners.legs).toEqual(['shoulders']);
  });

  it('need more than half of the type’s days', () => {
    const days = [LEGS_SHOULDERS, CHEST, LEGS, BACK];
    expect(planNextType(series(repeat(2, days)), exercises)?.partners.legs).toEqual([]);
  });

  it('do not include cardio', () => {
    const treadmill = ex('treadmill', 'cardio');
    const known = new Map([...exercises, [treadmill.id, treadmill]]);
    expect(planNextType(series(repeat(3, [{ treadmill: 1, ...CHEST }])), known)?.partners.chest).toEqual([]);
  });

  it.each([2, 3])('stay in the plan with a workout every %i days', (gap) => {
    for (const count of [30, 28, 29]) {
      const plan = planNextType(series(split(count), '2026-02-28', gap), exercises, { today: '2026-03-02', perWeek: gap === 2 ? 3 : 2 })!;
      expect(plan.leftOut).toEqual([]);
      expect(plan.added).toEqual([]);
      expect(plan.exerciseIds).toHaveLength(4);
    }
  });

  it('do not move to another day because the week is short of them', () => {
    const list = series(split(29), '2026-02-28', 3);
    for (const type of ['legs', 'back', 'chest']) {
      const plan = planNextType(list, exercises, { today: '2026-03-02', perWeek: 2 }, { type })!;
      const muscles = plan.exerciseIds.map((id) => exercises.get(id)?.muscle);
      expect(plan.added).toEqual([]);
      expect(new Set(muscles).size).toBe(2);
    }
  });

  it('come back after a day that skipped them', () => {
    const days: Record<string, number>[] = split(9);
    days[6] = { squat: 3, legPress: 3, legCurl: 3, legExtension: 3 };
    const plan = planNextType(series(days), exercises, after)!;
    expect(plan.key).toBe('legs');
    expect(plan.exerciseIds).toHaveLength(4);
    expect(plan.exerciseIds.slice(0, 3)).toEqual(['squat', 'legPress', 'legCurl']);
    expect(exercises.get(plan.exerciseIds[3])?.muscle).toBe('shoulders');
  });

  it('come with a joined type too', () => {
    const plan = planNextType(series(repeat(3, [{ ...CHEST_BACK, curl: 3 }])), exercises)!;
    expect(plan.key).toBe('chest+back');
    expect(plan.partners['chest+back']).toEqual(['biceps']);
    expect(plan.exerciseIds).toContain('curl');
  });
});
