import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog/exercises';
import { mainGroups } from '../catalog/groups';
import { setUiLang } from '../i18n.svelte';
import type { Exercise } from '../types';
import { groupWork, workoutTitle } from './title';

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

  it('go by a custom exercise’s muscle, and skip an exercise that’s gone', () => {
    const custom = { ...CATALOG[0], id: 'custom-1', muscle: 'back' } as Exercise;
    const known = new Map([[custom.id, custom]]);
    expect(mainGroups(groupWork([set('custom-1', 0), set('gone', 1)], known))).toEqual(['back']);
  });
});
