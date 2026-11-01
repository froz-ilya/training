import { describe, expect, it } from 'vitest';
import { groupOf, leadingGroup, mainGroups, type GroupWork } from './groups';

describe('muscle groups', () => {
  it('puts every muscle in a broad group', () => {
    expect(groupOf('triceps')).toBe('arms');
    expect(groupOf('calves')).toBe('legs');
    expect(groupOf('abs')).toBe('core');
  });

  it('names the groups a workout trained, in the fixed order', () => {
    const work = [
      { muscle: 'legs', sets: 3 },
      { muscle: 'chest', sets: 6 },
      { muscle: 'shoulders', sets: 3 },
    ] as const;
    expect(mainGroups([...work])).toEqual(['chest', 'legs', 'shoulders']);
  });

  it('leaves out a small group that only finished the workout', () => {
    const work = [
      { muscle: 'chest', sets: 9 },
      { muscle: 'triceps', sets: 3 },
      { muscle: 'abs', sets: 3 },
    ] as const;
    expect(mainGroups([...work])).toEqual(['chest']);
  });

  it('names a small group when it was the workout', () => {
    expect(mainGroups([{ muscle: 'biceps', sets: 4 }, { muscle: 'triceps', sets: 4 }, { muscle: 'abs', sets: 2 }])).toEqual(['arms']);
  });

  it('always names something, and counts an exercise with no work sets yet', () => {
    const work = [
      { muscle: 'biceps', sets: 3 },
      { muscle: 'abs', sets: 3 },
      { muscle: 'cardio', sets: 3 },
    ] as const;
    expect(mainGroups([...work])).toEqual(['arms']);
    expect(mainGroups([{ muscle: 'back', sets: 0 }])).toEqual(['back']);
  });

  it('names at most three groups', () => {
    const work = (['chest', 'back', 'legs', 'shoulders'] as const).map((muscle) => ({ muscle, sets: 3 }));
    expect(mainGroups(work)).toEqual(['chest', 'back', 'legs']);
  });

  it('has nothing to name without exercises', () => {
    expect(mainGroups([])).toEqual([]);
    expect(leadingGroup([])).toBeUndefined();
  });

  it('gives one split one name, however the sets fall and in any exercise order', () => {
    const split = (back: number, legs: number, shoulders: number): GroupWork[] => [
      { muscle: 'shoulders', sets: shoulders },
      { muscle: 'legs', sets: legs },
      { muscle: 'back', sets: back },
    ];
    for (const work of [split(6, 5, 5), split(5, 6, 5), split(5, 5, 6), split(4, 6, 5), split(6, 4, 5), split(5, 6, 4)]) {
      expect(mainGroups(work)).toEqual(['back', 'legs', 'shoulders']);
      expect(mainGroups([...work].reverse())).toEqual(['back', 'legs', 'shoulders']);
    }
  });

  it('still picks which groups to name by their sets', () => {
    const work = [
      { muscle: 'shoulders', sets: 4 },
      { muscle: 'legs', sets: 4 },
      { muscle: 'back', sets: 3 },
      { muscle: 'chest', sets: 5 },
    ] as const;
    expect(mainGroups([...work])).toEqual(['chest', 'legs', 'shoulders']);
  });

  it('goes by the most sets for the group a workout trained most', () => {
    expect(leadingGroup([{ muscle: 'back', sets: 4 }, { muscle: 'legs', sets: 9 }])).toBe('legs');
    expect(leadingGroup([{ muscle: 'legs', sets: 4 }, { muscle: 'back', sets: 4 }])).toBe('back');
  });
});
