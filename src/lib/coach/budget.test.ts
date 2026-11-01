import { describe, expect, it } from 'vitest';
import type { Exercise } from '../types';
import { muscleBudgets } from './budget';
import { planNextType, type RotationWorkout } from './next';

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
    ...['flat', 'inclineDb', 'flyes', 'cable', 'dips'].map((id) => ex(id, 'chest')),
    ...['row', 'pull', 'pulldown'].map((id) => ex(id, 'back')),
    ex('wrist', 'forearms'),
    ex('hammer', 'biceps'),
    ex('crunch', 'abs'),
    ex('legRaise', 'abs'),
  ].map((e) => [e.id, e]),
);

const MAIN = ['flat', 'inclineDb', 'flyes'];
const BACK = ['row', 'pull', 'pulldown'];
/** A Monday. */
const TODAY = '2026-03-02';
const pace = { today: TODAY, perWeek: 2 };

function daysBefore(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const on = (daysAgo: number, exerciseIds: string[]): RotationWorkout => {
  const date = daysBefore(TODAY, daysAgo);
  return { id: date, date, exerciseIds, workSets: Object.fromEntries(exerciseIds.map((id) => [id, 3])) };
};

/** Chest on Tuesday and back on Friday, for `count` weeks. Week 0 is the last 7 days, and back comes last. */
function weeks(count: number, chest: (week: number) => string[], back: (week: number) => string[] = () => BACK): RotationWorkout[] {
  const list: RotationWorkout[] = [];
  for (let week = count - 1; week >= 0; week--) list.push(on(7 * week + 6, chest(week)), on(7 * week + 3, back(week)));
  return list;
}

const WEEKS = 8;

describe('weekly budget', () => {
  it('swaps a filler already done this week for one that is due', () => {
    const plan = planNextType(weeks(WEEKS, (w) => [...MAIN, w % 2 ? 'crunch' : 'wrist']), exercises, pace)!;
    expect(plan.key).toBe('chest');
    expect(plan.exerciseIds).toEqual([...MAIN, 'crunch']);
    expect(plan.leftOut).toEqual(['wrist']);
    expect(plan.added).toEqual(['abs']);
  });

  it('swaps for the same pool without calling it due when the muscle is only under its count', () => {
    const plan = planNextType(weeks(WEEKS, (w) => [...MAIN, w % 2 ? 'cable' : 'wrist']), exercises, pace)!;
    expect(plan.exerciseIds).toEqual([...MAIN, 'cable']);
    expect(plan.leftOut).toEqual(['wrist']);
    expect(plan.added).toEqual([]);
  });

  it('leaves the slot out when nothing can take it', () => {
    const plan = planNextType(weeks(WEEKS, () => [...MAIN, 'cable', 'wrist']), exercises, pace)!;
    expect(plan.exerciseIds).toEqual([...MAIN, 'cable']);
    expect(plan.leftOut).toEqual(['wrist']);
    expect(plan.added).toEqual([]);
  });

  it('never goes under the minimum', () => {
    const list = weeks(
      WEEKS,
      (w) => (w === 0 ? ['flat', 'inclineDb'] : ['flat', 'inclineDb', 'wrist']),
      (w) => (w === 0 ? [...BACK, 'wrist'] : BACK),
    );
    const plan = planNextType(list, exercises, pace)!;
    expect(plan.exerciseIds).toEqual(['flat', 'inclineDb', 'wrist']);
    expect(plan.leftOut).toEqual([]);
  });

  it('never removes a main lift', () => {
    const plan = planNextType(weeks(WEEKS, () => ['flat', 'wrist', 'inclineDb', 'flyes']), exercises, pace)!;
    expect(plan.exerciseIds).toEqual(['flat', 'wrist', 'inclineDb', 'flyes']);
    expect(plan.leftOut).toEqual([]);
  });

  it('never limits the type’s own muscle', () => {
    const plan = planNextType(weeks(WEEKS, () => [...MAIN, 'cable', 'dips']), exercises, pace)!;
    expect(plan.exerciseIds).toEqual([...MAIN, 'cable', 'dips']);
    expect(plan.leftOut).toEqual([]);
  });

  it('brings in a due small muscle that the user does as a filler elsewhere', () => {
    const list = weeks(WEEKS, () => [...MAIN, 'wrist'], (w) => (w === 0 ? BACK : [...BACK, 'crunch']));
    const plan = planNextType(list, exercises, pace)!;
    expect(plan.exerciseIds).toEqual([...MAIN, 'crunch']);
    expect(plan.leftOut).toEqual(['wrist']);
    expect(plan.added).toEqual(['abs']);
  });

  it('chooses the exercise used longest ago', () => {
    const back = (w: number) => (w === 0 ? BACK : [...BACK, w % 2 ? 'crunch' : 'legRaise']);
    const plan = planNextType(weeks(WEEKS, () => [...MAIN, 'wrist'], back), exercises, pace)!;
    expect(plan.exerciseIds).toEqual([...MAIN, 'legRaise']);
  });

  it('does not borrow what the user only does as a main lift elsewhere', () => {
    const list = weeks(WEEKS, () => [...MAIN, 'wrist'], (w) => (w === 0 ? BACK : ['row', 'crunch', 'pull', 'pulldown']));
    const plan = planNextType(list, exercises, pace)!;
    expect(plan.exerciseIds).toEqual(MAIN);
    expect(plan.added).toEqual([]);
  });

  it('adds nothing when there is no free slot', () => {
    const list = weeks(WEEKS, () => [...MAIN, 'cable'], (w) => (w === 0 ? BACK : [...BACK, 'crunch']));
    const plan = planNextType(list, exercises, pace)!;
    expect(plan.exerciseIds).toEqual([...MAIN, 'cable']);
    expect(plan.added).toEqual([]);
  });

  it('changes nothing with little history', () => {
    const plan = planNextType(weeks(3, () => [...MAIN, 'wrist']), exercises, pace)!;
    expect(plan.exerciseIds).toEqual([...MAIN, 'wrist']);
    expect(plan.leftOut).toEqual([]);
    expect(plan.added).toEqual([]);
  });

  it('changes nothing for a muscle without a rhythm of its own', () => {
    const plan = planNextType(weeks(WEEKS, (w) => (w === 0 || w === 5 ? [...MAIN, 'wrist'] : [...MAIN, 'cable'])), exercises, pace)!;
    expect(plan.exerciseIds).toContain('wrist');
    expect(plan.leftOut).toEqual([]);
  });

  it('changes nothing without today’s date', () => {
    const plan = planNextType(weeks(WEEKS, () => [...MAIN, 'wrist']), exercises)!;
    expect(plan.exerciseIds).toEqual([...MAIN, 'wrist']);
    expect(plan.leftOut).toEqual([]);
  });

  it('counts the last 7 days across a Monday', () => {
    const list: RotationWorkout[] = [];
    for (let week = 6; week >= 1; week--) list.push(on(7 * week + 3, [...MAIN, 'wrist']), on(7 * week + 1, BACK));
    // A Sunday, with today the Monday after: a calendar week would have started afresh.
    list.push(on(1, [...BACK, 'wrist']));
    expect(muscleBudgets(list, exercises, TODAY).get('forearms')?.done).toBe(1);
    expect(planNextType(list, exercises, pace)?.leftOut).toEqual(['wrist']);
    // Eight days on it has left the window.
    const later = daysBefore(TODAY, -7);
    expect(muscleBudgets(list, exercises, later).get('forearms')?.done).toBe(0);
    expect(planNextType(list, exercises, { today: later, perWeek: 2 })?.exerciseIds).toContain('wrist');
  });

  it('respects the budget after a switch to another type', () => {
    const list = weeks(WEEKS, () => MAIN, () => [...BACK, 'wrist']);
    expect(planNextType(list, exercises, pace)?.key).toBe('chest');
    const plan = planNextType(list, exercises, pace, { type: 'back' })!;
    expect(plan.exerciseIds).toEqual(BACK);
    expect(plan.leftOut).toEqual(['wrist']);
  });

  it('can take a plan down to the minimum', () => {
    const plan = planNextType(weeks(WEEKS, () => [...MAIN, 'wrist']), exercises, pace)!;
    expect(plan.exerciseIds).toEqual(MAIN);
    expect(plan.leftOut).toEqual(['wrist']);
  });

  describe('usual count', () => {
    it('is the median of the trained weeks, without the last 7 days', () => {
      const list = weeks(WEEKS, (w) => (w === 0 ? [...MAIN, 'crunch', 'legRaise', 'crunch'] : w === 3 ? [...MAIN, 'crunch', 'legRaise'] : [...MAIN, 'crunch']));
      expect(muscleBudgets(list, exercises, TODAY).get('abs')).toEqual({ usual: 1, done: 3 });
    });

    it('skips weeks with no workouts', () => {
      const list = weeks(4, () => [...MAIN, 'crunch']).map((w, i) => (i < 4 ? { ...w, date: daysBefore(w.date, 70) } : w));
      const more = weeks(6, () => [...MAIN, 'crunch']).slice(0, 4).map((w) => ({ ...w, id: `old-${w.id}`, date: daysBefore(w.date, 120) }));
      expect(muscleBudgets([...more, ...list], exercises, TODAY).get('abs')?.usual).toBe(1);
    });

    it('counts only exercises with work sets', () => {
      const list = weeks(WEEKS, () => [...MAIN, 'crunch']).map((w) => ({ ...w, workSets: { flat: 3 } }));
      expect(muscleBudgets(list, exercises, TODAY).has('abs')).toBe(false);
    });

    it('has no rule at all with too few trained weeks', () => {
      expect(muscleBudgets(weeks(4, () => [...MAIN, 'crunch']), exercises, TODAY).size).toBe(0);
      expect(muscleBudgets(weeks(5, () => [...MAIN, 'crunch']), exercises, TODAY).size).toBeGreaterThan(0);
    });
  });
});
