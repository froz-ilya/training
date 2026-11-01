import { describe, expect, it } from 'vitest';
import { isKnownRoute, isTabRoot } from './router.svelte';

describe('routes', () => {
  it('knows every page', () => {
    for (const path of ['/', '/history', '/progress', '/exercises', '/settings', '/import', '/workout/a1', '/group/back', '/exercise/custom-a']) {
      expect(isKnownRoute(path), path).toBe(true);
    }
  });

  it('treats anything else as a bad link', () => {
    for (const path of ['/nope', '/constructor', '/workout', '/workout/', '/workout/a1/b2', '/history/', '/history/a1', '/import/a1']) {
      expect(isKnownRoute(path), path).toBe(false);
      expect(isTabRoot(path), path).toBe(false);
    }
  });
});
