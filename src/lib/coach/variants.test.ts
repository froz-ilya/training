import { describe, expect, it } from 'vitest';
import type { Exercise } from '../types';
import { nextKey, nextVariant, planNextType, variantLeads, type RotationWorkout } from './next';

const ex = (id: string, muscle: Exercise['muscle']): Exercise => ({
  id,
  names: { en: id, de: id, ru: id },
  muscle,
  equipment: 'barbell',
  load: 'weight',
  compound: true,
});

const exercises = new Map(
  [
    ...['flat', 'inclineDb', 'flyes', 'inclineBar', 'dbPress', 'machine', 'dips', 'cable', 'pushUp'].map((id) => ex(id, 'chest')),
    ex('triceps', 'triceps'),
    ex('row', 'back'),
    ex('squat', 'legs'),
    ex('deadlift', 'legs'),
    ex('legPress', 'legs'),
    ex('curl', 'legs'),
    ex('treadmill', 'cardio'),
  ].map((e) => [e.id, e]),
);

const A = ['flat', 'inclineDb', 'flyes'];
const B = ['inclineBar', 'dbPress', 'machine'];
const C = ['dips', 'cable', 'pushUp'];

/** Chest workouts every three days, with a back day between so the rotation lands on chest. */
function chestDays(days: string[][], gapAfter: Record<number, number> = {}): RotationWorkout[] {
  const d = new Date('2026-01-01T12:00:00');
  const list: RotationWorkout[] = [];
  const add = (exerciseIds: string[]) => {
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    list.push({ id: `${date}-${list.length}`, date, exerciseIds, workSets: {} });
    d.setDate(d.getDate() + 3);
  };
  days.forEach((exerciseIds, i) => {
    add(exerciseIds);
    add(['row']);
    d.setDate(d.getDate() + (gapAfter[i] ?? 0));
  });
  return list;
}

const plan = (days: string[][], lead?: string) => planNextType(chestDays(days), exercises, undefined, { lead })!;

describe('workout variants', () => {
  it('moves to the other variant when two alternate', () => {
    const next = plan([A, B, A, B, A]);
    expect(next.key).toBe('chest');
    expect(next.exerciseIds).toEqual(B);
    expect(next.reason).toEqual({ kind: 'alternate', after: 'flat', lead: 'inclineBar' });
    expect(next.otherLeads).toEqual(['flat']);
    expect(plan([A, B, A, B]).exerciseIds).toEqual(A);
  });

  it('goes round three variants', () => {
    expect(plan([A, B, C, A, B, C, A]).exerciseIds).toEqual(B);
    expect(plan([A, B, C, A, B, C, A, B]).exerciseIds).toEqual(C);
    expect(plan([A, B, C, A, B, C]).otherLeads).toEqual(['dips', 'inclineBar']);
  });

  it('ignores a one-off, wherever it falls', () => {
    const X = ['pushUp', 'cable', 'triceps'];
    const next = plan([A, B, A, B, X]);
    expect(next.exerciseIds).toEqual(A);
    expect(next.reason).toEqual({ kind: 'afterOneOff', after: 'inclineBar', lead: 'flat' });
    expect(plan([A, B, X, A, B, A]).exerciseIds).toEqual(B);
    expect(plan([A, B, A, X, B, A]).reason?.kind).toBe('alternate');
  });

  it('does not let a one-off lead a single variant, but offers it', () => {
    const X = ['pushUp', 'cable', 'triceps'];
    const next = plan([A, A, A, X]);
    expect(next.exerciseIds).toEqual(A);
    expect(next.reason).toBeNull();
    expect(next.otherLeads).toEqual(['pushUp']);
  });

  it('changes nothing with a single variant', () => {
    const next = plan([A, A, A, A]);
    expect(next.exerciseIds).toEqual(A);
    expect(next.reason).toBeNull();
    expect(next.otherLeads).toEqual([]);
  });

  it('keeps a small change within the variant', () => {
    const changed = ['flat', 'inclineDb', 'dips'];
    expect(variantLeads(chestDays([A, B, changed, B]).filter((w) => w.exerciseIds[0] !== 'row'), 'chest', exercises)).toEqual(['flat', 'inclineBar', 'flat', 'inclineBar']);
    expect(plan([A, B, changed, B]).exerciseIds).toEqual(changed);
  });

  it('counts a different lead on one day as the same variant when the rest matches', () => {
    const swapped = ['machine', 'inclineDb', 'flyes'];
    const next = plan([A, B, A, B, swapped, B]);
    expect(next.exerciseIds).toEqual(A);
    expect(next.reason).toEqual({ kind: 'alternate', after: 'inclineBar', lead: 'flat' });
    expect(next.otherLeads).toEqual(['inclineBar']);
    // The rotation moves on after the swapped day, and the reason names what that day really had.
    const after = plan([A, B, A, B, swapped]);
    expect(after.exerciseIds).toEqual(B);
    expect(after.reason).toEqual({ kind: 'alternate', after: 'machine', lead: 'inclineBar' });
  });

  it('plans from a workout with the real lead after a swapped day', () => {
    const swapped = ['machine', 'inclineDb', 'flyes'];
    const next = plan([A, A, swapped]);
    expect(next.exerciseIds).toEqual(A);
    expect(next.otherLeads).toEqual([]);
  });

  it('keeps two leads apart when they keep coming back, even with shared exercises', () => {
    const squatDay = ['squat', 'legPress', 'curl'];
    const deadliftDay = ['deadlift', 'legPress', 'curl'];
    const list = [squatDay, deadliftDay, squatDay, deadliftDay, squatDay].map((exerciseIds, i): RotationWorkout => ({ id: String(i), date: `2026-01-0${i + 1}`, exerciseIds, workSets: {} }));
    expect(planNextType(list, exercises)?.exerciseIds).toEqual(deadliftDay);
  });

  it('follows a change of order that keeps coming back', () => {
    const flipped = ['inclineDb', 'flat', 'flyes'];
    expect(plan([A, flipped, A, flipped, A]).exerciseIds).toEqual(flipped);
  });

  it('stays on a variant that usually follows itself', () => {
    expect(nextKey(['a', 'a', 'a', 'b', 'a', 'a', 'a', 'b', 'a'])).toBe('b');
    expect(nextVariant(['a', 'a', 'a', 'b', 'a', 'a', 'a', 'b', 'a'])).toBe('a');
    const next = plan([A, A, A, B, A, A, A, B, A]);
    expect(next.exerciseIds).toEqual(A);
    expect(next.reason).toEqual({ kind: 'again', after: 'flat', lead: 'flat' });
  });

  it('breaks a tie with the variant left longest', () => {
    expect(nextVariant(['b', 'a', 'c', 'a', 'b', 'c'])).toBe('a');
  });

  it('picks up the rotation after a long gap', () => {
    const list = chestDays([A, B, A, B, A], { 3: 120 });
    expect(planNextType(list, exercises, { today: '2026-08-01', perWeek: 3 })?.exerciseIds).toEqual(B);
  });

  it('settles on a new variant after a long gap', () => {
    expect(planNextType(chestDays([A, B, A, B, C, C, C], { 3: 120 }), exercises)?.exerciseIds).toEqual(C);
  });

  it('works with fewer workouts than the lookback', () => {
    expect(plan([A]).exerciseIds).toEqual(A);
    expect(plan([A]).otherLeads).toEqual([]);
    const two = plan([A, B]);
    expect(two.exerciseIds).toEqual(B);
    expect(two.reason).toBeNull();
    expect(two.otherLeads).toEqual(['flat']);
    expect(plan([A, B, A, B]).otherLeads).toEqual(['inclineBar']);
  });

  it('looks only at the recent workouts of the type', () => {
    const old = Array.from({ length: 6 }, () => C);
    const recent = [A, B, A, B, A, B, A, B, A, B];
    const next = plan([...old, ...recent]);
    expect(next.exerciseIds).toEqual(A);
    expect(next.otherLeads).toEqual(['inclineBar']);
  });

  it('keeps variants apart in the rotating slots', () => {
    const AOne = [...A, 'dips', 'triceps'];
    const ATwo = [...A, 'cable', 'triceps'];
    const BLong = [...B, 'pushUp', 'triceps'];
    expect(plan([AOne, BLong, ATwo, BLong]).exerciseIds).toEqual(AOne.slice(0, 3).concat('dips', 'triceps'));
    expect(plan([AOne, BLong, ATwo, BLong]).exerciseIds).not.toContain('pushUp');
  });

  it('sizes the plan from the chosen variant', () => {
    const long = [...A, 'dips', 'cable', 'triceps'];
    expect(plan([long, B, long, B]).exerciseIds).toHaveLength(6);
    expect(plan([long, B, long, B, long]).exerciseIds).toHaveLength(3);
  });

  it('skips a warm-up when finding the lead', () => {
    const warmed = (ids: string[], date: string): RotationWorkout => ({ id: date, date, exerciseIds: ['treadmill', ...ids], workSets: Object.fromEntries(ids.map((id) => [id, 3])) });
    const list = [warmed(A, '2026-01-01'), warmed(B, '2026-01-03'), warmed(A, '2026-01-05'), warmed(B, '2026-01-07'), warmed(A, '2026-01-09')];
    expect(planNextType(list, exercises)?.exerciseIds).toEqual(['treadmill', ...B]);
  });

  it('switches to the variant the user picks, and back', () => {
    const days = [A, B, C, A, B, C, A];
    const picked = plan(days, 'dips');
    expect(picked.exerciseIds).toEqual(C);
    expect(picked.reason).toBeNull();
    expect(picked.otherLeads).toEqual(['inclineBar', 'flat']);
    expect(plan(days, 'inclineBar')).toEqual(plan(days));
  });

  it('can pick a one-off', () => {
    const X = ['pushUp', 'cable', 'triceps'];
    expect(plan([A, A, A, X], 'pushUp').exerciseIds).toEqual(X);
  });

  it('ignores a pick that is no variant of this type', () => {
    expect(plan([A, B, A, B, A], 'squat')).toEqual(plan([A, B, A, B, A]));
  });
});

describe('type rotation', () => {
  /** One workout per key, a day apart, all from the listed exercise. */
  const days = (keys: string[]): RotationWorkout[] =>
    keys.map((key, i) => ({ id: String(i), date: `2026-01-${String(i + 1).padStart(2, '0')}`, exerciseIds: [{ c: 'flat', b: 'row', l: 'squat' }[key] ?? key], workSets: {} }));

  it('follows the last two types, not only the latest', () => {
    const keys = ['l', 'c', 'b', 'l', 'c', 'b', 'l', 'b', 'c', 'l', 'c', 'b', 'l', 'b', 'c'];
    expect(nextKey(keys)).toBe('l');
  });

  it('falls back to the latest type when the last two have no match', () => {
    expect(nextKey(['a', 'b', 'c', 'a', 'b', 'c', 'b'])).toBe('c');
  });

  it('gives a tie to the type left longest', () => {
    expect(nextKey(['a', 'b', 'c', 'a', 'b', 'd', 'c', 'd', 'a', 'b'])).toBe('c');
  });

  it('does not count a one-off as a match for the last two', () => {
    expect(nextKey(['a', 'b', 'once', 'a', 'c', 'b', 'c', 'a', 'b'])).toBe('c');
  });

  it('never repeats the latest type while there is another', () => {
    expect(nextKey(['a', 'b', 'a', 'a', 'b', 'a'])).toBe('b');
  });

  it('applies to variants too', () => {
    expect(nextVariant(['a', 'a', 'b', 'a', 'a', 'b', 'a', 'a'])).toBe('b');
  });

  describe('reason', () => {
    const planOf = (keys: string[], pace?: { today: string; perWeek: number }) => planNextType(days(keys), exercises, pace)!;

    it('calls an order usual when it has come up more than once', () => {
      expect(planOf(['c', 'b', 'l', 'c', 'b', 'l', 'c', 'b']).typeReason).toEqual({ kind: 'usual', types: ['chest', 'back', 'legs'] });
    });

    it('says only that it happened before when it has come up once', () => {
      expect(planOf(['c', 'b', 'l', 'c', 'l', 'b', 'c', 'b']).typeReason).toEqual({ kind: 'before', types: ['chest', 'back', 'legs'] });
    });

    it('does not call a tied order usual', () => {
      const next = planOf(['c', 'b', 'l', 'c', 'b', 'triceps', 'c', 'b', 'l', 'c', 'b', 'triceps', 'c', 'b']);
      expect(next.typeReason).toEqual({ kind: 'before', types: ['chest', 'back', 'legs'] });
    });

    it('names the longest wait when no order backs the choice', () => {
      expect(planOf(['c', 'b', 'l']).typeReason).toEqual({ kind: 'longest', types: ['chest'] });
    });

    it('stays quiet rather than call a type the longest wait when a one-off waited longer', () => {
      const next = planOf(['c', 'b', 'l', 'c', 'b']);
      expect(next.key).toBe('chest');
      expect(next.typeReason).toBeNull();
    });

    it('names the longest wait when a type is overdue', () => {
      const keys = ['l', 'c', 'b', 'c', 'b', 'c', 'b', 'l', 'c', 'b'];
      const list = days(keys).map((w, i) => ({ ...w, date: `2026-02-${String(i * 3 + 1).padStart(2, '0')}` }));
      const next = planNextType(list, exercises, { today: '2026-03-03', perWeek: 3 })!;
      expect(next.key).toBe('legs');
      expect(next.typeReason).toEqual({ kind: 'longest', types: ['legs'] });
    });

    it('stays out of it with one type', () => {
      expect(planOf(['c', 'c', 'c']).typeReason).toBeNull();
    });
  });

  describe('switching', () => {
    const keys = ['c', 'b', 'l', 'c', 'b', 'l', 'c', 'b'];
    const pickOf = (pick: { type?: string; lead?: string }, list = days(keys)) => planNextType(list, exercises, undefined, pick)!;

    it('offers the other regular types, left longest first', () => {
      expect(planNextType(days(keys), exercises)?.otherTypes).toEqual(['chest', 'back']);
    });

    it('leaves one-offs and a lone type out', () => {
      expect(planNextType(days([...keys, 'once']), exercises)?.otherTypes).not.toContain('once');
      expect(planNextType(days(['c', 'c', 'c']), exercises)?.otherTypes).toEqual([]);
    });

    it('rebuilds the plan for the picked type and drops the reason', () => {
      const next = pickOf({ type: 'back' });
      expect(next.key).toBe('back');
      expect(next.exerciseIds).toEqual(['row']);
      expect(next.typeReason).toBeNull();
      expect(next.otherTypes).toEqual(['legs', 'chest']);
    });

    it('is the plain suggestion again when the suggested type is picked', () => {
      expect(pickOf({ type: 'legs' })).toEqual(planNextType(days(keys), exercises));
    });

    it('keeps variants working in the picked type', () => {
      const list = chestDays([A, B, A, B, A]);
      list.push({ id: 'legs-1', date: '2026-03-01', exerciseIds: ['squat'], workSets: {} }, { id: 'legs-2', date: '2026-03-02', exerciseIds: ['squat'], workSets: {} });
      const picked = pickOf({ type: 'chest' }, list);
      expect(picked.exerciseIds).toEqual(B);
      expect(picked.reason).toEqual({ kind: 'alternate', after: 'flat', lead: 'inclineBar' });
      expect(pickOf({ type: 'chest', lead: 'flat' }, list).exerciseIds).toEqual(A);
    });

    it('ignores a type that is not in the window', () => {
      expect(pickOf({ type: 'cardio' })).toEqual(planNextType(days(keys), exercises));
    });
  });
});
