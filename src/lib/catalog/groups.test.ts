import { describe, expect, it } from 'vitest';
import type { Exercise, Muscle } from '../types';
import { CATALOG } from './exercises';
import { dayWork, groupOf, leadingGroup, mainGroups, type GroupWork } from './groups';

const catalog = new Map<string, Exercise>(CATALOG.map((e) => [e.id, e]));

/** Work on an invented exercise for `muscle`, a machine compound unless it's light. */
const w = (muscle: Muscle, sets: number, light = false): GroupWork => ({
  exercise: { id: `custom-${muscle}${light ? '-light' : ''}`, muscle, compound: !light, equipment: 'machine' },
  sets,
});
/** Work on a catalogue exercise. */
const c = (id: string, sets = 3): GroupWork => ({ exercise: catalog.get(id)!, sets });

describe('muscle groups', () => {
  it('puts every muscle in a broad group', () => {
    expect(groupOf('triceps')).toBe('arms');
    expect(groupOf('calves')).toBe('legs');
    expect(groupOf('abs')).toBe('core');
  });

  it('names the groups a workout trained, in the fixed order', () => {
    const work = [w('legs', 3), w('chest', 6), w('shoulders', 3)];
    expect(mainGroups([...work])).toEqual(['chest', 'legs', 'shoulders']);
  });

  it('leaves out a small group that only finished the workout', () => {
    const work = [w('chest', 9), w('triceps', 3), w('abs', 3)];
    expect(mainGroups([...work])).toEqual(['chest']);
  });

  it('names a small group when it was the workout', () => {
    expect(mainGroups([w('biceps', 4), w('triceps', 4), w('abs', 2)])).toEqual(['arms']);
  });

  it('always names something, and counts an exercise with no work sets yet', () => {
    const work = [w('biceps', 3), w('abs', 3), w('cardio', 3)];
    expect(mainGroups([...work])).toEqual(['arms']);
    expect(mainGroups([w('back', 0)])).toEqual(['back']);
  });

  it('names at most three groups', () => {
    const work = (['chest', 'back', 'legs', 'shoulders'] as const).map((muscle) => w(muscle, 3));
    expect(mainGroups(work)).toEqual(['chest', 'back', 'legs']);
  });

  it('has nothing to name without exercises', () => {
    expect(mainGroups([])).toEqual([]);
    expect(leadingGroup([])).toBeUndefined();
  });

  it('gives one split one name, however the sets fall and in any exercise order', () => {
    const split = (back: number, legs: number, shoulders: number): GroupWork[] => [w('shoulders', shoulders), w('legs', legs), w('back', back)];
    for (const work of [split(6, 5, 5), split(5, 6, 5), split(5, 5, 6), split(4, 6, 5), split(6, 4, 5), split(5, 6, 4)]) {
      expect(mainGroups(work)).toEqual(['back', 'legs', 'shoulders']);
      expect(mainGroups([...work].reverse())).toEqual(['back', 'legs', 'shoulders']);
    }
  });

  it('still picks which groups to name by their sets', () => {
    const work = [w('shoulders', 4), w('legs', 4), w('back', 3), w('chest', 5)];
    expect(mainGroups([...work])).toEqual(['chest', 'legs', 'shoulders']);
  });

  describe('light work for chest, back or legs', () => {
    const chestDay = [c('barbell-bench-press'), c('incline-barbell-press'), c('lateral-raise'), c('rope-pushdown')];

    it('doesn’t name its group next to heavier work for another', () => {
      // 3 sets of leg curl out of 15 would make a fifth of the day.
      expect(mainGroups([...chestDay, c('lying-leg-curl')])).toEqual(['chest', 'shoulders']);
      expect(mainGroups([c('barbell-row'), c('lat-pulldown'), c('pec-deck', 4)])).toEqual(['back']);
      expect(mainGroups([c('leg-press'), c('barbell-squat'), c('standing-calf-raise'), c('straight-arm-pulldown')])).toEqual(['legs']);
    });

    it('takes no share of the day, so the rest reads as it would without it', () => {
      const day = [c('barbell-bench-press', 6), c('incline-barbell-press', 6), c('lateral-raise', 3)];
      expect(mainGroups(day)).toEqual(['chest', 'shoulders']);
      expect(mainGroups([...day, c('lying-leg-curl', 3), c('leg-extension', 3)])).toEqual(['chest', 'shoulders']);
    });

    it('still names its group on that group’s own day', () => {
      expect(mainGroups([c('leg-press'), c('lying-leg-curl'), c('leg-extension'), c('standing-calf-raise')])).toEqual(['legs']);
      expect(mainGroups([c('barbell-bench-press'), c('leg-press'), c('lying-leg-curl')])).toEqual(['chest', 'legs']);
    });

    it('reads a day of only light work in full', () => {
      expect(mainGroups([c('leg-extension'), c('lying-leg-curl'), c('standing-calf-raise')])).toEqual(['legs']);
      expect(mainGroups([c('pec-deck'), c('straight-arm-pulldown'), c('lying-leg-curl')])).toEqual(['chest', 'back', 'legs']);
    });

    it('leaves out nothing else', () => {
      const work = [c('barbell-bench-press'), c('lateral-raise'), c('rope-pushdown'), c('crunch'), c('lying-leg-curl')];
      expect(dayWork(work).map((item) => item.exercise.id)).toEqual(['barbell-bench-press', 'lateral-raise', 'rope-pushdown', 'crunch']);
      const light = [w('legs', 3, true), w('back', 3, true)];
      expect(dayWork(light)).toEqual(light);
    });
  });

  it('goes by the most sets for the group a workout trained most', () => {
    expect(leadingGroup([w('back', 4), w('legs', 9)])).toBe('legs');
    expect(leadingGroup([w('legs', 4), w('back', 4)])).toBe('back');
  });
});
