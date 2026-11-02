import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog/exercises';
import type { Equipment, Exercise } from '../types';
import { findStandIn, replaceAvoided } from './standIn';

const catalog = new Map<string, Exercise>(CATALOG.map((e) => [e.id, e]));
const NONE = new Set<string>();

const standInFor = (id: string, done: string[] = [], avoid: Set<string> = new Set([id]), taken: Set<string> = NONE, exercises = catalog) =>
  findStandIn(exercises.get(id)!, exercises, avoid, taken, done);

/** A user's own legs exercise, so only its equipment tells it from the others. */
const own = (id: string, equipment: Equipment, extra: Partial<Exercise> = {}): Exercise => ({
  id,
  names: { en: id, de: id, ru: id },
  muscle: 'legs',
  equipment,
  load: 'weight',
  compound: true,
  ...extra,
});
const mapOf = (...list: Exercise[]) => new Map(list.map((e) => [e.id, e]));

describe('findStandIn', () => {
  it('picks the Smith squat for someone who already does it', () => {
    expect(standInFor('barbell-squat', ['barbell-squat', 'smith-squat'])).toEqual({ exerciseId: 'smith-squat', instead: 'barbell-squat', fresh: false });
  });

  it('takes what the user has done over a closer new exercise', () => {
    expect(standInFor('barbell-squat', ['leg-press'])).toMatchObject({ exerciseId: 'leg-press', fresh: false });
  });

  it('among what they have done, takes the most alike', () => {
    expect(standInFor('barbell-squat', ['smith-lunge', 'smith-squat'])?.exerciseId).toBe('smith-lunge');
  });

  it('then the latest', () => {
    expect(standInFor('barbell-squat', ['smith-squat', 'leg-press'])?.exerciseId).toBe('leg-press');
    expect(standInFor('barbell-squat', ['leg-press', 'smith-squat'])?.exerciseId).toBe('smith-squat');
  });

  it('doesn’t take a hinge for a squat because of the glutes they share', () => {
    expect(standInFor('barbell-squat', ['smith-squat', 'romanian-deadlift'])?.exerciseId).toBe('smith-squat');
    expect(standInFor('barbell-squat', ['romanian-deadlift'])).toEqual({ exerciseId: 'plie-squat', instead: 'barbell-squat', fresh: true });
  });

  it('doesn’t take a squat for a hinge either', () => {
    expect(standInFor('romanian-deadlift', ['barbell-squat'])).toBeUndefined();
  });

  it('with no history, leaves the barbell for a lifter who dropped it', () => {
    const pick = standInFor('barbell-squat');
    expect(pick).toMatchObject({ exerciseId: 'plie-squat', fresh: true });
    expect(catalog.get(pick!.exerciseId)!.equipment).not.toBe('barbell');
  });

  it('prefers other equipment among new exercises', () => {
    const list = mapOf(own('out', 'barbell'), own('same', 'barbell'), own('other', 'dumbbell'));
    expect(standInFor('out', [], new Set(['out']), NONE, list)).toMatchObject({ exerciseId: 'other', fresh: true });
  });

  it('then equipment the user has used, then catalogue order', () => {
    const list = mapOf(own('out', 'barbell'), own('first', 'dumbbell'), own('second', 'machine'), own('third', 'machine'), own('curl', 'machine', { muscle: 'biceps' }));
    expect(standInFor('out', [], new Set(['out']), NONE, list)?.exerciseId).toBe('first');
    expect(standInFor('out', ['curl'], new Set(['out']), NONE, list)?.exerciseId).toBe('second');
  });

  it('takes more shared regions over equipment the user has used', () => {
    expect(standInFor('barbell-squat', ['leg-extension'])?.exerciseId).toBe('plie-squat');
  });

  it('counts a user’s own exercises', () => {
    const list = new Map([...catalog, ['custom-squat', own('custom-squat', 'smith')]]);
    expect(standInFor('barbell-squat', ['custom-squat'], new Set(['barbell-squat']), NONE, list)).toMatchObject({ exerciseId: 'custom-squat', fresh: false });
  });

  it('skips other muscles, kinds of lift and loads', () => {
    const list = mapOf(
      own('out', 'barbell'),
      own('back', 'smith', { muscle: 'back' }),
      own('single', 'smith', { compound: false }),
      own('body', 'smith', { load: 'body' }),
    );
    expect(standInFor('out', ['back', 'single', 'body'], new Set(['out']), NONE, list)).toBeUndefined();
  });

  it('skips what doesn’t share a main region', () => {
    expect(standInFor('lying-leg-curl', ['leg-extension'])?.exerciseId).toBe('seated-leg-curl');
  });

  it('skips the avoided, the taken and the exercise itself', () => {
    const done = ['barbell-squat', 'hack-squat', 'smith-squat'];
    expect(standInFor('barbell-squat', done, new Set(['barbell-squat', 'smith-squat']))?.exerciseId).toBe('hack-squat');
    expect(standInFor('barbell-squat', done, new Set(['barbell-squat']), new Set(['smith-squat']))?.exerciseId).toBe('hack-squat');
  });

  it('finds nothing for what has no region to share', () => {
    expect(standInFor('treadmill', ['elliptical'])).toBeUndefined();
  });

  it('finds nothing when no exercise is like it', () => {
    expect(standInFor('leg-extension')).toBeUndefined();
  });

  it('survives history of exercises that are gone', () => {
    expect(standInFor('barbell-squat', ['gone', 'smith-squat'])?.exerciseId).toBe('smith-squat');
  });
});

describe('replaceAvoided', () => {
  const replace = (ids: string[], avoid: string[], done: string[] = []) => replaceAvoided(ids, catalog, new Set(avoid), done);

  it('keeps each stand-in in the place of what it replaces', () => {
    const { exerciseIds, standIns } = replace(['lying-leg-curl', 'barbell-squat', 'leg-extension'], ['barbell-squat'], ['smith-squat']);
    expect(exerciseIds).toEqual(['lying-leg-curl', 'smith-squat', 'leg-extension']);
    expect(standIns).toEqual([{ exerciseId: 'smith-squat', instead: 'barbell-squat', fresh: false }]);
  });

  it('takes out what has no stand-in', () => {
    expect(replace(['barbell-squat', 'leg-extension'], ['leg-extension'])).toEqual({ exerciseIds: ['barbell-squat'], standIns: [] });
  });

  it('doesn’t use one exercise twice', () => {
    const { exerciseIds } = replace(['barbell-squat', 'front-squat', 'leg-press'], ['barbell-squat', 'front-squat'], ['smith-squat']);
    expect(exerciseIds[0]).toBe('smith-squat');
    expect(exerciseIds[1]).not.toBe('smith-squat');
    expect(new Set(exerciseIds).size).toBe(3);
  });

  it('doesn’t use what comes later in the list', () => {
    const { exerciseIds } = replace(['barbell-squat', 'smith-squat'], ['barbell-squat'], ['smith-squat']);
    expect(exerciseIds).toHaveLength(2);
    expect(new Set(exerciseIds).size).toBe(2);
  });

  it('leaves a list with nothing avoided as it is', () => {
    expect(replace(['barbell-squat', 'leg-press'], [])).toEqual({ exerciseIds: ['barbell-squat', 'leg-press'], standIns: [] });
  });
});
