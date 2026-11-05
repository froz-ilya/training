import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog/exercises';
import { mainGroups } from '../catalog/groups';
import { setUiLang } from '../i18n.svelte';
import type { Exercise } from '../types';
import { groupWork, typeTitle, workoutTitle } from './title';

const exercises = new Map<string, Exercise>(CATALOG.map((e) => [e.id, e]));
const set = (exerciseId: string, entry: number, kind: 'warmup' | 'work' = 'work') => ({ exerciseId, entry, kind });

describe('workout titles', () => {
  afterEach(() => setUiLang('en'));

  it('follow the interface language', () => {
    expect(workoutTitle(['chest', 'legs'])).toBe('Chest, legs');
    setUiLang('ru');
    expect(workoutTitle(['chest', 'legs'])).toBe('Грудь, ноги');
    setUiLang('de');
    expect(workoutTitle(['chest', 'legs'])).toBe('Brust, Beine');
  });

  it('name a type with the muscles usually trained with it', () => {
    expect(typeTitle(['back'], ['biceps'])).toBe('Back, biceps');
    expect(typeTitle(['chest', 'back'], [])).toBe('Chest, back');
    setUiLang('ru');
    expect(typeTitle(['back'], ['biceps'])).toBe('Спина, бицепс');
    setUiLang('de');
    expect(typeTitle(['back'], ['biceps'])).toBe('Rücken, Bizeps');
  });

  it('name those muscles rather than their group', () => {
    expect(typeTitle(['back', 'arms'], ['biceps'])).toBe('Back, biceps');
    expect(typeTitle(['legs', 'shoulders'], ['shoulders'])).toBe('Legs, shoulders');
  });

  it('say "Workout" with no exercises', () => {
    expect(workoutTitle([])).toBe('Workout');
  });

  it('come from a workout’s work sets, not its warm-ups', () => {
    const sets = [
      set('barbell-bench-press', 0, 'warmup'),
      set('barbell-bench-press', 0),
      set('leg-press', 1),
      set('leg-press', 1),
      set('leg-press', 1),
    ];
    expect(mainGroups(groupWork(sets, exercises))).toEqual(['chest', 'legs']);
  });

  it('don’t name legs for a leg curl on a chest day, but do on a legs day', () => {
    const day = (ids: string[]) => workoutTitle(mainGroups(groupWork(ids.flatMap((id, entry) => [set(id, entry), set(id, entry), set(id, entry)]), exercises)));
    expect(day(['barbell-bench-press', 'incline-barbell-press', 'lateral-raise', 'rope-pushdown', 'lying-leg-curl'])).toBe('Chest, shoulders');
    expect(day(['leg-press', 'barbell-squat', 'lying-leg-curl', 'lateral-raise'])).toBe('Legs, shoulders');
    expect(day(['leg-extension', 'lying-leg-curl', 'standing-calf-raise'])).toBe('Legs');
  });

  it('go by a custom exercise’s muscle, and skip an exercise that’s gone', () => {
    const custom = { ...CATALOG[0], id: 'custom-1', muscle: 'back' } as Exercise;
    const known = new Map([[custom.id, custom]]);
    expect(mainGroups(groupWork([set('custom-1', 0), set('gone', 1)], known))).toEqual(['back']);
  });
});
