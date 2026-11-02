import { describe, expect, it } from 'vitest';
import { CATALOG, catalogExercise } from './exercises';
import { CATALOG_DIFFICULTY, DIFFICULTY_POINTS, difficultyOf, difficultyPoints } from './difficulty';

describe('exercise difficulty', () => {
  it('lists every exercise in the catalogue, and nothing else', () => {
    expect([...CATALOG_DIFFICULTY.keys()].sort()).toEqual(CATALOG.map((e) => e.id).sort());
  });

  it('tells apart compound exercises', () => {
    expect(catalogExercise('bulgarian-split-squat')!.compound).toBe(true);
    expect(catalogExercise('machine-chest-press')!.compound).toBe(true);
    expect(difficultyOf(catalogExercise('bulgarian-split-squat')!)).toBe('hard');
    expect(difficultyOf(catalogExercise('machine-chest-press')!)).toBe('medium');
  });

  it('counts a row as hard only when nothing supports the chest', () => {
    for (const id of ['barbell-row', 't-bar-row', 'underhand-barbell-row']) expect(difficultyOf(catalogExercise(id)!), id).toBe('hard');
    for (const id of ['chest-supported-row', 'seated-cable-row', 'dumbbell-row']) expect(difficultyOf(catalogExercise(id)!), id).toBe('medium');
  });

  it('counts a machine that works one joint as light', () => {
    expect(difficultyOf(catalogExercise('hip-abductor')!)).toBe('light');
  });

  it('never rates an isolation exercise hard', () => {
    const hard = CATALOG.filter((e) => !e.compound && difficultyOf(e) === 'hard').map((e) => e.id);
    expect(hard).toEqual([]);
  });

  it('rates all cardio light', () => {
    for (const exercise of CATALOG.filter((e) => e.muscle === 'cardio')) expect(difficultyOf(exercise), exercise.id).toBe('light');
  });

  it('adds more points the harder the level', () => {
    expect(DIFFICULTY_POINTS.light).toBeLessThan(DIFFICULTY_POINTS.medium);
    expect(DIFFICULTY_POINTS.medium).toBeLessThan(DIFFICULTY_POINTS.hard);
    expect(difficultyPoints(catalogExercise('deadlift')!)).toBe(DIFFICULTY_POINTS.hard);
  });

  describe('a user’s own exercise', () => {
    it('is light when it isn’t compound', () => {
      expect(difficultyOf({ id: 'custom-1', compound: false, equipment: 'barbell' })).toBe('light');
    });

    it('is hard for a free-weight compound lift', () => {
      for (const equipment of ['barbell', 'dumbbell', 'other'] as const) {
        expect(difficultyOf({ id: 'custom-1', compound: true, equipment }), equipment).toBe('hard');
      }
    });

    it('is medium for any other compound lift', () => {
      for (const equipment of ['machine', 'cable', 'smith', 'bodyweight'] as const) {
        expect(difficultyOf({ id: 'custom-1', compound: true, equipment }), equipment).toBe('medium');
      }
    });

    it('gets its points from the level', () => {
      expect(difficultyPoints({ id: 'custom-1', compound: true, equipment: 'dumbbell' })).toBe(DIFFICULTY_POINTS.hard);
    });
  });
});
