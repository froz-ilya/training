import { describe, expect, it } from 'vitest';
import { BODY_REGIONS } from '../../lib/catalog/regions';
import { BACK, FRONT } from './bodyShapes';

describe('body drawing', () => {
  it('draws every region', () => {
    const drawn = new Set([...FRONT, ...BACK].map((shape) => shape.region));
    expect(BODY_REGIONS.filter((region) => !drawn.has(region))).toEqual([]);
  });

  it('draws a region once in each view', () => {
    for (const view of [FRONT, BACK]) {
      const regions = view.map((shape) => shape.region);
      expect(new Set(regions).size).toBe(regions.length);
    }
  });
});
