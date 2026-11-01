import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog/exercises';
import type { BodyRegion, Exercise } from '../types';
import { bodyLoad, hasEnoughHistory, regionRange, regionStatus, type BodyLoad } from './balance';

const TODAY = '2026-03-29';
/** A date that many whole weeks back from today, up to 4. */
const weeksAgo = (weeks: number) => `2026-03-${String(29 - weeks * 7).padStart(2, '0')}`;

const exercises = new Map<string, Exercise>(CATALOG.map((e) => [e.id, e]));
const sets = (exerciseId: string, count: number, date: string) => Array.from({ length: count }, () => ({ exerciseId, date }));

const perWeek = (load: BodyLoad, region: BodyRegion) => load.regions.find((r) => r.region === region)!.perWeek;
const shares = (load: BodyLoad, region: BodyRegion) => load.regions.find((r) => r.region === region)!.shares;

describe('bodyLoad', () => {
  it('counts a set in full for the main region and as half for a helper', () => {
    const date = weeksAgo(0);
    const load = bodyLoad(sets('barbell-bench-press', 8, date), [date], exercises, TODAY);
    expect(perWeek(load, 'chest')).toBe(8);
    expect(perWeek(load, 'triceps')).toBe(4);
    expect(perWeek(load, 'frontDelts')).toBe(4);
    expect(perWeek(load, 'lats')).toBe(0);
  });

  it('averages over the weeks with workouts, so a week off doesn’t lower it', () => {
    const first = weeksAgo(0);
    const second = weeksAgo(2);
    const load = bodyLoad([...sets('pec-deck', 10, first), ...sets('pec-deck', 6, second)], [first, second], exercises, TODAY);
    expect(load.weeks).toBe(2);
    expect(perWeek(load, 'chest')).toBe(8);
  });

  it('counts a week whose workout trained something else', () => {
    const first = weeksAgo(0);
    const second = weeksAgo(1);
    const load = bodyLoad(sets('pec-deck', 10, first), [first, second], exercises, TODAY);
    expect(perWeek(load, 'chest')).toBe(5);
  });

  it('leaves out anything older than four weeks, and anything dated ahead', () => {
    const recent = weeksAgo(3);
    const old = weeksAgo(4);
    const load = bodyLoad(
      [...sets('pec-deck', 8, recent), ...sets('pec-deck', 20, old), ...sets('pec-deck', 20, '2026-04-02')],
      [recent, old, '2026-04-02'],
      exercises,
      TODAY,
    );
    expect(load.weeks).toBe(1);
    expect(perWeek(load, 'chest')).toBe(8);
  });

  it('skips exercises that no longer exist, and cardio', () => {
    const date = weeksAgo(0);
    const load = bodyLoad([...sets('gone', 5, date), ...sets('treadmill', 5, date)], [date], exercises, TODAY);
    expect(load.regions.every((r) => r.perWeek === 0)).toBe(true);
  });

  it('rounds to a whole number of sets', () => {
    const date = weeksAgo(0);
    const load = bodyLoad(sets('barbell-bench-press', 7, date), [date], exercises, TODAY);
    expect(perWeek(load, 'triceps')).toBe(4);
  });

  it('is empty with no workouts', () => {
    const load = bodyLoad([], [], exercises, TODAY);
    expect(load.weeks).toBe(0);
    expect(load.regions.every((r) => r.perWeek === 0 && !r.shares.length)).toBe(true);
  });

  it('lists what a region’s sets came from, biggest part first', () => {
    const date = weeksAgo(0);
    const work = [...sets('barbell-bench-press', 6, date), ...sets('cable-pushdown', 4, date)];
    const list = shares(bodyLoad(work, [date], exercises, TODAY), 'triceps');
    expect(list.map((s) => [s.exercise.id, s.sets, s.helper])).toEqual([
      ['cable-pushdown', 4, false],
      ['barbell-bench-press', 6, true],
    ]);
  });
});

describe('hasEnoughHistory', () => {
  it('needs workouts in two of the recent weeks', () => {
    expect(hasEnoughHistory({ weeks: 1, regions: [] })).toBe(false);
    expect(hasEnoughHistory({ weeks: 2, regions: [] })).toBe(true);
  });
});

describe('regionStatus', () => {
  const { low, high } = regionRange('chest');

  it('reads the ends of the range as normal', () => {
    expect(regionStatus({ region: 'chest', perWeek: low })).toBe('normal');
    expect(regionStatus({ region: 'chest', perWeek: high })).toBe('normal');
  });

  it('reads anything outside the range as less or more', () => {
    expect(regionStatus({ region: 'chest', perWeek: low - 1 })).toBe('less');
    expect(regionStatus({ region: 'chest', perWeek: high + 1 })).toBe('more');
    expect(regionStatus({ region: 'chest', perWeek: 0 })).toBe('less');
  });

  it('takes extra work on a focus region as normal', () => {
    expect(regionStatus({ region: 'chest', perWeek: high + 1 }, 'focus')).toBe('normal');
  });

  it('asks more of a focus region', () => {
    expect(regionStatus({ region: 'chest', perWeek: low }, 'focus')).toBe('less');
  });

  it('asks less of a region being maintained', () => {
    expect(regionStatus({ region: 'chest', perWeek: low - 1 }, 'maintain')).toBe('normal');
    expect(regionRange('chest', 'maintain').low).toBeGreaterThan(0);
    expect(regionRange('chest', 'maintain').high).toBeLessThan(high);
  });

  it('takes an ignored region out of the picture', () => {
    expect(regionStatus({ region: 'chest', perWeek: 0 }, 'ignore')).toBe('ignored');
  });

  it('never gives a range that can’t be met', () => {
    for (const region of ['forearms', 'lowerBack', 'frontDelts'] as const) {
      for (const goal of [undefined, 'focus', 'maintain'] as const) {
        const range = regionRange(region, goal);
        expect(range.low).toBeGreaterThan(0);
        expect(range.high).toBeGreaterThan(range.low);
      }
    }
  });
});
