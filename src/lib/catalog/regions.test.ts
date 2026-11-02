import { describe, expect, it } from 'vitest';
import { CATALOG, catalogExercise } from './exercises';
import { BODY_REGIONS, CATALOG_REGIONS, regionsOf } from './regions';

describe('body regions', () => {
  it('lists every exercise in the catalogue, and nothing else', () => {
    expect([...CATALOG_REGIONS.keys()].sort()).toEqual(CATALOG.map((e) => e.id).sort());
  });

  it('gives every exercise a region, except cardio', () => {
    for (const exercise of CATALOG) {
      const { main, helpers } = regionsOf(exercise);
      const count = main.length + helpers.length;
      if (exercise.muscle === 'cardio') expect(count, exercise.id).toBe(0);
      else expect(count, exercise.id).toBeGreaterThan(0);
    }
  });

  it('never lists a region twice for an exercise', () => {
    for (const exercise of CATALOG) {
      const { main, helpers } = regionsOf(exercise);
      expect(new Set([...main, ...helpers]).size, exercise.id).toBe(main.length + helpers.length);
    }
  });

  it('has exercises that train each region directly', () => {
    const trained = new Set(CATALOG.flatMap((e) => regionsOf(e).main));
    expect(BODY_REGIONS.filter((region) => !trained.has(region))).toEqual([]);
  });

  it('tells apart exercises that share a muscle', () => {
    expect(regionsOf(catalogExercise('lateral-raise')!).main).toEqual(['sideDelts']);
    expect(regionsOf(catalogExercise('face-pull')!).main).toEqual(['rearDelts']);
    expect(regionsOf(catalogExercise('lying-leg-curl')!).main).toEqual(['hamstrings']);
    expect(regionsOf(catalogExercise('leg-extension')!).main).toEqual(['quads']);
  });

  it('counts the glutes as a main muscle where the hip drives the lift', () => {
    const forGlutes = ['barbell-squat', 'plie-squat', 'bulgarian-split-squat', 'lunge', 'smith-lunge', 'pistol-squat', 'step-up', 'deadlift', 'romanian-deadlift', 'hip-thrust'];
    for (const id of forGlutes) expect(regionsOf(catalogExercise(id)!).main, id).toContain('glutes');
    for (const id of ['leg-press', 'hack-squat', 'front-squat']) expect(regionsOf(catalogExercise(id)!).helpers, id).toContain('glutes');
  });

  it('counts the lower back in a row only when nothing supports the chest', () => {
    for (const id of ['barbell-row', 't-bar-row', 'underhand-barbell-row']) expect(regionsOf(catalogExercise(id)!).helpers, id).toContain('lowerBack');
    for (const id of ['chest-supported-row', 'seated-cable-row', 'dumbbell-row']) expect(regionsOf(catalogExercise(id)!).helpers, id).not.toContain('lowerBack');
  });

  describe('a user’s own exercise', () => {
    it('goes by its muscle', () => {
      expect(regionsOf({ id: 'custom-1', muscle: 'back' })).toEqual({ main: ['lats'], helpers: ['upperBack'] });
    });

    it('adds the muscles that help', () => {
      expect(regionsOf({ id: 'custom-1', muscle: 'chest', helpers: ['triceps'] })).toEqual({ main: ['chest'], helpers: ['triceps'] });
    });

    it('never counts a region as its own helper', () => {
      expect(regionsOf({ id: 'custom-1', muscle: 'legs', helpers: ['legs', 'glutes'] })).toEqual({ main: ['quads'], helpers: ['hamstrings', 'glutes'] });
    });

    it('has no regions for cardio', () => {
      expect(regionsOf({ id: 'custom-1', muscle: 'cardio' })).toEqual({ main: [], helpers: [] });
    });
  });
});
