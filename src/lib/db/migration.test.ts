// Data saved by older app versions must open and work in the current one (see CLAUDE.md).
// Each test builds a database exactly as an old version stored it, then opens it with today's code.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrainingDB } from './schema';

/** Schemas exactly as each released version declared them. Never edit these: add a new one. */
const V1 = {
  workouts: 'id, date, status, sourceKey',
  sets: 'id, workoutId, exerciseId, [exerciseId+date]',
  customExercises: 'id',
  aliases: 'name',
  exerciseSettings: 'exerciseId',
  baselines: 'id, exerciseId',
  stallRecords: 'id, exerciseId',
  settings: 'id',
  exerciseNotes: 'id, workoutId, exerciseId, [exerciseId+date]',
};
const V2 = { ...V1, bodyWeights: 'date' };

function oldDb(version: number, stores: Record<string, string>) {
  const d = new Dexie('training');
  d.version(version).stores(stores);
  return d;
}

/** Records as v1 saved them. Invented data; never edit these: add a new set for a new version. */
const v1Workout = {
  id: 'w1',
  date: '2026-03-02',
  title: 'Push',
  status: 'done',
  source: 'import',
  updatedAt: 1,
  rawText: '02.03.26 Push\nBench press 40 kg - 10',
  sourceKey: '2026-03-02:abc',
};
const v1Set = {
  id: 's1',
  workoutId: 'w1',
  exerciseId: 'barbell-bench-press',
  date: '2026-03-02',
  entry: 0,
  order: 0,
  kind: 'work',
  weightKg: 40,
  reps: 10,
  done: true,
};
const v1Custom = {
  id: 'custom-1',
  names: { en: 'Sled push', de: '', ru: '' },
  muscle: 'legs',
  equipment: 'other',
  load: 'weight',
  compound: true,
  createdAt: 1,
};
const v1Settings = {
  id: 'main',
  uiLang: 'de',
  exerciseLang: 'ru',
  theme: 'dark',
  bodyWeightKg: 70,
  backupEvery: 14,
  lastBackupAt: 5,
  backupSnoozeUntil: 0,
};

async function seedV1() {
  const d = oldDb(1, V1);
  await d.table('workouts').put(v1Workout);
  await d.table('sets').put(v1Set);
  await d.table('customExercises').put(v1Custom);
  await d.table('aliases').put({ name: 'bench', exerciseId: 'barbell-bench-press' });
  await d.table('exerciseSettings').put({ exerciseId: 'machine-chest-press', machineSetting: 'seat 8' });
  await d.table('baselines').put({ id: 'b1', exerciseId: 'rope-pushdown', date: '2026-01-01' });
  await d.table('stallRecords').put({ id: 'r1', exerciseId: 'deadlift', action: 'swap', date: '2026-02-01' });
  await d.table('settings').put(v1Settings);
  d.close();
}

async function openCurrent(): Promise<TrainingDB> {
  const { db } = await import('./schema');
  await db.open();
  return db;
}

beforeEach(async () => {
  await Dexie.delete('training');
  await Dexie.delete('training-safety');
  vi.resetModules();
});

describe('database versions', () => {
  it('opens v1 data with everything in it', async () => {
    await seedV1();
    const db = await openCurrent();
    expect(await db.workouts.get('w1')).toEqual(v1Workout);
    expect(await db.sets.where('[exerciseId+date]').equals(['barbell-bench-press', '2026-03-02']).toArray()).toEqual([v1Set]);
    expect(await db.customExercises.get('custom-1')).toEqual(v1Custom);
    expect(await db.aliases.count()).toBe(1);
    expect(await db.exerciseSettings.get('machine-chest-press')).toMatchObject({ machineSetting: 'seat 8' });
    expect(await db.baselines.count()).toBe(1);
    expect(await db.stallRecords.count()).toBe(1);
    expect(await db.settings.get('main')).toEqual(v1Settings);
    db.close();
  });

  it('reads v1 settings through today’s defaults', async () => {
    await seedV1();
    const db = await openCurrent();
    const { loadSettings, settings } = await import('../settings.svelte');
    await loadSettings();
    expect(settings).toMatchObject({ uiLang: 'de', exerciseLang: 'ru', theme: 'dark', bodyWeightKg: 70, lastBackupAt: 5 });
    db.close();
  });

  it('stores comments next to v1 data', async () => {
    await seedV1();
    const db = await openCurrent();
    expect(await db.exerciseNotes.count()).toBe(0);
    await db.exerciseNotes.put({ id: 'n1', workoutId: 'w1', exerciseId: 'barbell-bench-press', date: '2026-03-02', tags: ['tired'] });
    expect(await db.exerciseNotes.where('[exerciseId+date]').equals(['barbell-bench-press', '2026-03-02']).count()).toBe(1);
    expect(await db.workouts.get('w1')).toEqual(v1Workout);
    db.close();
  });

  it('reads v1 settings with no custom tags', async () => {
    await seedV1();
    const db = await openCurrent();
    const { loadSettings, settings } = await import('../settings.svelte');
    await loadSettings();
    expect(settings.customTags).toEqual([]);
    db.close();
  });

  it('reads v1 settings with no region goals', async () => {
    await seedV1();
    const db = await openCurrent();
    const { loadSettings, settings } = await import('../settings.svelte');
    await loadSettings();
    expect(settings.regionGoals).toEqual({});
    db.close();
  });

  it('restores a v1 backup with everything in it', async () => {
    await seedV1();
    const db = await openCurrent();
    const { exportBackup, restoreBackup } = await import('./backup');
    const text = await (await exportBackup()).text();
    await db.workouts.clear();
    await db.sets.clear();
    await db.customExercises.clear();
    expect(await restoreBackup(text)).toEqual({ workouts: 1, dropped: 0 });
    expect(await db.workouts.get('w1')).toEqual(v1Workout);
    expect(await db.sets.get('s1')).toEqual(v1Set);
    expect(await db.customExercises.get('custom-1')).toEqual(v1Custom);
    expect(await db.settings.get('main')).toMatchObject({ uiLang: 'de', exerciseLang: 'ru', theme: 'dark', bodyWeightKg: 70 });
    db.close();
  });

  it('leaves v1 data alone in a tab that a newer version overtakes', async () => {
    await seedV1();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = await openCurrent();
    const later = oldDb(3, V2);
    await later.open();
    await expect(db.workouts.put({ ...v1Workout, title: 'Changed' } as never)).rejects.toThrow();
    expect(await later.table('workouts').toArray()).toEqual([v1Workout]);
    later.close();
    warn.mockRestore();
  });

  it('starts the weight log from the v1 setting, which stays as it was', async () => {
    await seedV1();
    const db = await openCurrent();
    const { toISODate } = await import('../dates');
    expect(await db.bodyWeights.toArray()).toEqual([{ date: toISODate(), kg: 70 }]);
    expect(await db.settings.get('main')).toEqual(v1Settings);
    db.close();
  });

  it('starts an empty weight log when v1 had no weight set', async () => {
    await seedV1();
    const d = oldDb(1, V1);
    await d.table('settings').put({ ...v1Settings, bodyWeightKg: 0 });
    d.close();
    const db = await openCurrent();
    expect(await db.bodyWeights.count()).toBe(0);
    db.close();
  });

  it('dates the weight in a v1 backup by the day it was made', async () => {
    await seedV1();
    const db = await openCurrent();
    const { restoreBackup } = await import('./backup');
    const file = { app: 'training', version: 1, exportedAt: '2026-03-02T10:00:00', data: { workouts: [v1Workout], sets: [v1Set], settings: [v1Settings] } };
    expect(await restoreBackup(JSON.stringify(file))).toEqual({ workouts: 1, dropped: 0 });
    expect(await db.bodyWeights.toArray()).toEqual([{ date: '2026-03-02', kg: 70 }]);
    db.close();
  });

  it('restores the weight log from a backup, leaving out what can’t be read', async () => {
    await seedV1();
    const db = await openCurrent();
    const { restoreBackup } = await import('./backup');
    const bodyWeights = [{ date: '2026-03-02', kg: 71.5 }, { date: '2026-03-03', kg: 'heavy' }, { date: 'soon', kg: 70 }, { date: '2026-03-04', kg: 0 }];
    const file = { app: 'training', version: 2, exportedAt: '', data: { workouts: [v1Workout], sets: [v1Set], bodyWeights } };
    expect(await restoreBackup(JSON.stringify(file))).toEqual({ workouts: 1, dropped: 3 });
    expect(await db.bodyWeights.toArray()).toEqual([{ date: '2026-03-02', kg: 71.5 }]);
    db.close();
  });

  it('adds a backup’s weigh-ins once, keeping the ones on the device', async () => {
    await seedV1();
    const db = await openCurrent();
    await db.bodyWeights.clear();
    await db.bodyWeights.put({ date: '2026-03-02', kg: 69 });
    const { importHistory } = await import('./backup');
    const bodyWeights = [{ date: '2026-03-02', kg: 71 }, { date: '2026-03-09', kg: 72 }];
    const text = JSON.stringify({ app: 'training', version: 2, exportedAt: '', data: { workouts: [], sets: [], bodyWeights } });
    await importHistory(text);
    await importHistory(text);
    expect(await db.bodyWeights.toArray()).toEqual([{ date: '2026-03-02', kg: 69 }, { date: '2026-03-09', kg: 72 }]);
    db.close();
  });

  it('lists every table in USER_TABLES, so backups miss nothing', async () => {
    const db = await openCurrent();
    const { USER_TABLES } = await import('./schema');
    expect(db.tables.map((table) => table.name).sort()).toEqual([...USER_TABLES].sort());
    db.close();
  });

  it('declares the current version as SCHEMA_VERSION', async () => {
    const db = await openCurrent();
    const { SCHEMA_VERSION } = await import('./schema');
    expect(db.verno).toBe(SCHEMA_VERSION);
    db.close();
  });
});
