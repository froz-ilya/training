import { describe, expect, it } from 'vitest';
import { CATALOG, MUSCLES, allNames, catalogExercise, exerciseName, normalizeName, searchExercises } from './exercises';
import type { Exercise } from '../types';

describe('catalogue', () => {
  it('has unique ids in lower-case kebab case', () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('never uses the prefix reserved for custom exercises', () => {
    expect(CATALOG.filter((e) => e.id.startsWith('custom-'))).toEqual([]);
  });

  it('names every exercise in all three languages', () => {
    for (const exercise of CATALOG) {
      for (const name of Object.values(exercise.names)) expect(name.trim(), exercise.id).not.toBe('');
    }
  });

  it('never gives two exercises the same name or alias', () => {
    const owners = new Map<string, string>();
    for (const exercise of CATALOG) {
      for (const name of allNames(exercise).map(normalizeName)) {
        const owner = owners.get(name);
        if (owner && owner !== exercise.id) expect.fail(`"${name}" belongs to ${owner} and ${exercise.id}`);
        owners.set(name, exercise.id);
      }
    }
  });

  it('uses known muscles only', () => {
    for (const exercise of CATALOG) expect(MUSCLES).toContain(exercise.muscle);
  });

  it('measures exercises that lift the body as body weight plus added weight', () => {
    const bodyLoaded = ['back-extension', 'dips', 'pull-up', 'chin-up', 'neutral-grip-pull-up', 'lunge', 'bulgarian-split-squat', 'step-up'];
    for (const id of bodyLoaded) expect(catalogExercise(id)?.load, id).toBe('body');
  });

  it('never measures a bodyweight exercise as plain weight', () => {
    expect(CATALOG.filter((e) => e.equipment === 'bodyweight' && e.load === 'weight').map((e) => e.id)).toEqual([]);
  });

  it('keeps exercises that move only a weight or a machine as plain weight', () => {
    for (const id of ['barbell-squat', 'leg-press', 'seated-dip-machine', 'lat-pulldown']) expect(catalogExercise(id)?.load, id).toBe('weight');
  });

  describe('helper muscles', () => {
    const withHelpers = CATALOG.filter((e) => e.helpers);

    it('uses known muscles only', () => {
      for (const exercise of withHelpers) {
        for (const muscle of exercise.helpers ?? []) expect(MUSCLES, exercise.id).toContain(muscle);
      }
    });

    it('never repeats the main muscle', () => {
      for (const exercise of withHelpers) expect(exercise.helpers, exercise.id).not.toContain(exercise.muscle);
    });

    it('has no duplicates and no empty lists', () => {
      for (const exercise of withHelpers) {
        const helpers = exercise.helpers ?? [];
        expect(helpers.length, exercise.id).toBeGreaterThan(0);
        expect(new Set(helpers).size, exercise.id).toBe(helpers.length);
      }
    });

    it('lists triceps on every compound barbell chest press', () => {
      const presses = CATALOG.filter((e) => e.muscle === 'chest' && e.equipment === 'barbell' && e.compound);
      expect(presses.map((e) => e.id)).toContain('barbell-bench-press');
      for (const exercise of presses) expect(exercise.helpers, exercise.id).toContain('triceps');
    });

    it('lists biceps on rows and vertical pulls', () => {
      const pulls = CATALOG.filter((e) => e.muscle === 'back' && e.compound && /row|pull-?up|pulldown|chin-up/.test(e.id));
      expect(pulls.map((e) => e.id)).toEqual(expect.arrayContaining(['barbell-row', 'seated-cable-row', 'pull-up', 'chin-up', 'lat-pulldown']));
      for (const exercise of pulls) expect(exercise.helpers, exercise.id).toContain('biceps');
    });
  });

  it('finds an exercise by id', () => {
    expect(catalogExercise('deadlift')?.names.de).toBe('Kreuzheben');
    expect(catalogExercise('nope')).toBeUndefined();
  });
});

describe('normalizeName', () => {
  it('ignores case, ё and punctuation', () => {
    expect(normalizeName('  Подъём ног, в висе! ')).toBe('подъем ног в висе');
  });
});

describe('exerciseName', () => {
  const custom = { names: { en: '', de: '', ru: 'Моя' } } as Exercise;

  it('falls back to a language that has a name', () => {
    expect(exerciseName(custom, 'en')).toBe('Моя');
  });
});

describe('searchExercises', () => {
  const ids = (query: string) => searchExercises(CATALOG, query).map((e) => e.id);

  it('finds exercises in all three languages', () => {
    expect(ids('Kreuzheben')).toContain('deadlift');
    expect(ids('становая')).toContain('deadlift');
    expect(ids('deadlift')).toContain('deadlift');
  });

  it('matches every word, in any order', () => {
    expect(ids('press bench')).toContain('barbell-bench-press');
  });

  it('puts names that start with the query first', () => {
    expect(ids('dips')[0]).toBe('dips');
  });

  it('returns everything for an empty query', () => {
    expect(searchExercises(CATALOG, '  ')).toHaveLength(CATALOG.length);
  });
});
