import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogExercise } from './exercises';
import { EXERCISE_PHOTOS, PHOTOS, photoOf } from './photos';

const FOLDER = join(import.meta.dirname, '../../../public/photos');

describe('exercise photos', () => {
  it('only points at exercises in the catalogue', () => {
    for (const id of Object.keys(EXERCISE_PHOTOS)) expect(catalogExercise(id), id).toBeDefined();
  });

  it('ships exactly the pictures it credits', () => {
    const credited = Object.values(PHOTOS).map((photo) => photo.file).sort();
    expect(readdirSync(FOLDER).sort()).toEqual(credited);
  });

  it('uses every picture it ships', () => {
    const used = new Set(Object.values(EXERCISE_PHOTOS));
    expect(Object.keys(PHOTOS).filter((key) => !used.has(key as keyof typeof PHOTOS))).toEqual([]);
  });

  it('credits the author and links the licence and source of every picture', () => {
    for (const photo of Object.values(PHOTOS)) {
      expect(photo.author.trim(), photo.file).not.toBe('');
      expect(photo.licenseUrl, photo.file).toMatch(/^https:\/\/creativecommons\.org\/licenses\//);
      expect(photo.source, photo.file).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });

  it('has no photo for a custom exercise', () => {
    expect(photoOf('custom-anything')).toBeUndefined();
  });
});
