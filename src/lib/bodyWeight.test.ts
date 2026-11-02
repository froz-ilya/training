import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseBodyKg, removeBodyWeight, saveBodyWeight, weightChangeText, weightOn } from './bodyWeight';
import { exerciseRecords } from './coach/summary';
import type { Session } from './coach/strength';
import { db } from './db/schema';
import { settings } from './settings.svelte';

const log = [
  { date: '2026-03-01', kg: 80 },
  { date: '2026-04-01', kg: 78 },
  { date: '2026-05-01', kg: 76 },
];

describe('weightOn', () => {
  it('reads the latest weigh-in up to the day', () => {
    expect(weightOn(log, '2026-04-01')).toBe(78);
    expect(weightOn(log, '2026-04-20')).toBe(78);
    expect(weightOn(log, '2026-06-01')).toBe(76);
  });

  it('reads the first weigh-in for a day before the log begins', () => {
    expect(weightOn(log, '2026-01-01')).toBe(80);
  });

  it('has nothing to say with an empty log', () => {
    expect(weightOn([], '2026-01-01')).toBeUndefined();
  });
});

describe('parseBodyKg', () => {
  it('takes a dot or a comma', () => {
    expect(parseBodyKg('72.5')).toBe(72.5);
    expect(parseBodyKg(' 72,5 ')).toBe(72.5);
  });

  it.each(['', ' ', '0', '-70', 'heavy', '501'])('refuses %j', (value) => {
    expect(parseBodyKg(value)).toBeNull();
  });
});

describe('weightChangeText', () => {
  it('has nothing to say with one weigh-in', () => {
    expect(weightChangeText(log.slice(0, 1))).toBe('');
  });

  it('shows the change since the weigh-in before', () => {
    expect(weightChangeText(log)).toMatch(/^−2 kg since /);
    expect(weightChangeText([...log.slice(0, 2).reverse()])).toMatch(/^\+2 kg since /);
  });

  it('rounds away the error in adding decimals', () => {
    expect(weightChangeText([{ date: '2026-03-01', kg: 80.1 }, { date: '2026-03-02', kg: 80.3 }])).toMatch(/^\+0\.2 kg since /);
  });

  it('says when nothing changed', () => {
    expect(weightChangeText([log[0], { date: '2026-04-01', kg: 80 }])).toMatch(/^No change since /);
  });
});

describe('exercise records by the day', () => {
  const session = (date: string, reps: number): Session => ({
    workoutId: date,
    date,
    position: 1,
    sets: [{ kind: 'work', weightKg: 0, reps }],
  });

  it('reads each session at what the user weighed then', () => {
    // At a fixed weight the later session wins on reps; 10 reps at 80 kg was still more.
    const sessions = [session('2026-03-01', 10), session('2026-05-01', 11)];
    expect(exerciseRecords(sessions, 'body', 76).bestEstimateDate).toBe('2026-05-01');
    const records = exerciseRecords(sessions, 'body', (date) => weightOn(log, date)!);
    expect(records.bestEstimateDate).toBe('2026-03-01');
  });
});

describe('the log and the setting', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    settings.bodyWeightKg = 0;
  });

  it('keeps the setting on the latest weigh-in, whatever order they come in', async () => {
    await saveBodyWeight({ date: '2026-03-02', kg: 80 });
    await saveBodyWeight({ date: '2026-03-01', kg: 82 });
    expect(settings.bodyWeightKg).toBe(80);
    expect((await db.settings.get('main'))?.bodyWeightKg).toBe(80);
  });

  it('holds one weigh-in a day', async () => {
    await saveBodyWeight({ date: '2026-03-02', kg: 80 });
    await saveBodyWeight({ date: '2026-03-02', kg: 79.5 });
    expect(await db.bodyWeights.toArray()).toEqual([{ date: '2026-03-02', kg: 79.5 }]);
  });

  it('moves a weigh-in to another day', async () => {
    await saveBodyWeight({ date: '2026-03-02', kg: 80 });
    await saveBodyWeight({ date: '2026-03-05', kg: 80 }, '2026-03-02');
    expect(await db.bodyWeights.toArray()).toEqual([{ date: '2026-03-05', kg: 80 }]);
  });

  it('falls back to the weigh-in before, then to not set', async () => {
    await saveBodyWeight({ date: '2026-03-01', kg: 82 });
    await saveBodyWeight({ date: '2026-03-02', kg: 80 });
    await removeBodyWeight('2026-03-02');
    expect(settings.bodyWeightKg).toBe(82);
    await removeBodyWeight('2026-03-01');
    expect(settings.bodyWeightKg).toBe(0);
  });
});
