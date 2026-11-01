import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DB_NAME, SCHEMA_VERSION, TrainingDB } from './schema';
import {
  droppedRows,
  isDay,
  KEEP_COPIES,
  listCopies,
  normalizeTables,
  preflight,
  readInstalledSettings,
  restoreCopy,
  saveCurrentCopy,
  SAFETY_DB_NAME,
  schemaVersionOf,
} from './safety';

const workout = (id: string) => ({ id, date: '2026-02-03', status: 'done', source: 'app', updatedAt: 1 });
const STORES = { workouts: 'id', settings: 'id' };

beforeEach(async () => {
  // Stays closed until a test touches it, like the app before preflight() has run.
  db.close({ disableAutoOpen: false });
  await Dexie.delete(DB_NAME);
  await Dexie.delete(SAFETY_DB_NAME);
});

async function installAt(version: number) {
  const installed = new Dexie(DB_NAME);
  installed.version(version).stores(STORES);
  await installed.table('workouts').put(workout('old'));
  installed.close();
}

describe('schemaVersionOf', () => {
  it('reads Dexie’s verno as a schema version', () => {
    expect(schemaVersionOf(1)).toBe(1);
    expect(schemaVersionOf(1.1)).toBe(1);
    expect(schemaVersionOf(0.5)).toBe(0);
  });

  it('matches what a dynamic open reports for an installed database', async () => {
    await db.open();
    db.close({ disableAutoOpen: false });
    const installed = new Dexie(DB_NAME);
    await installed.open();
    expect(schemaVersionOf(installed.verno)).toBe(SCHEMA_VERSION);
    installed.close();
  });
});

describe('preflight', () => {
  it('does nothing for a new install and creates no database', async () => {
    expect(await preflight()).toBe('ok');
    expect(await Dexie.exists(DB_NAME)).toBe(false);
    expect(await listCopies()).toEqual([]);
  });

  it('makes no copy when the data is current', async () => {
    await db.open();
    await db.workouts.put(workout('now') as never);
    db.close({ disableAutoOpen: false });
    expect(await preflight()).toBe('ok');
    expect(await listCopies()).toEqual([]);
  });

  it('copies older data before the upgrade, then the upgrade keeps it', async () => {
    await installAt(SCHEMA_VERSION - 0.5);
    expect(await preflight()).toBe('ok');
    const [copy] = await listCopies();
    expect(copy.version).toBe(SCHEMA_VERSION - 1);
    expect(copy.tables.workouts).toEqual([workout('old')]);
    expect(await db.workouts.get('old')).toMatchObject({ id: 'old' });
  });

  it('stops on newer data and leaves it untouched', async () => {
    await installAt(SCHEMA_VERSION + 1);
    expect(await preflight()).toBe('update-needed');
    expect(await listCopies()).toEqual([]);
    const installed = new Dexie(DB_NAME);
    await installed.open();
    expect(schemaVersionOf(installed.verno)).toBe(SCHEMA_VERSION + 1);
    expect(await installed.table('workouts').toArray()).toEqual([workout('old')]);
    installed.close();
  });

  describe('when the copy can’t be saved', () => {
    const copyFails = async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const table = vi.spyOn(Dexie.prototype, 'table').mockImplementation(() => {
        throw new Error('full');
      });
      try {
        return await preflight();
      } finally {
        table.mockRestore();
        warn.mockRestore();
      }
    };

    it('stops before the upgrade, with the data as it was', async () => {
      await installAt(SCHEMA_VERSION - 0.5);
      expect(await copyFails()).toBe('copy-failed');
      const installed = new Dexie(DB_NAME);
      await installed.open();
      expect(schemaVersionOf(installed.verno)).toBe(SCHEMA_VERSION - 1);
      expect(await installed.table('workouts').toArray()).toEqual([workout('old')]);
      installed.close();
      expect(await listCopies()).toEqual([]);
    });

    it('doesn’t lock the user out: the data still opens when they choose to go on', async () => {
      await installAt(SCHEMA_VERSION - 0.5);
      await copyFails();
      expect(await db.workouts.get('old')).toMatchObject({ id: 'old' });
    });

    it('saves the copy on the next try, once there’s room', async () => {
      await installAt(SCHEMA_VERSION - 0.5);
      await copyFails();
      expect(await preflight()).toBe('ok');
      expect(await listCopies()).toHaveLength(1);
    });

    it('has a backup file to offer from the data as it is', async () => {
      await installAt(SCHEMA_VERSION - 0.5);
      const { installedBackup, parseBackup } = await import('./backup');
      const text = await (await installedBackup()).text();
      expect(JSON.parse(text).version).toBe(SCHEMA_VERSION - 1);
      expect(parseBackup(text).workouts).toEqual([workout('old')]);
    });
  });

  it('reads the saved language from newer data without touching it', async () => {
    const installed = new Dexie(DB_NAME);
    installed.version(SCHEMA_VERSION + 1).stores(STORES);
    await installed.table('settings').put({ id: 'main', uiLang: 'de' });
    installed.close();
    expect(await readInstalledSettings()).toMatchObject({ uiLang: 'de' });
    expect(await preflight()).toBe('update-needed');
  });
});

describe('a tab that’s still running when newer data arrives', () => {
  const NAME = 'training-old-tab';
  const LATER = { ...Object.fromEntries(db.tables.map((table) => [table.name, table.schema.primKey.src])), later: 'id' };
  let open: Dexie[] = [];

  const running = async () => {
    const tab = new TrainingDB(NAME);
    open.push(tab);
    await tab.workouts.put(workout('kept') as never);
    return tab;
  };
  const newer = (version = SCHEMA_VERSION + 1) => {
    const tab = new Dexie(NAME);
    tab.version(version).stores(LATER);
    open.push(tab);
    return tab;
  };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => {
      vi.restoreAllMocks();
      for (const tab of open) tab.close();
      open = [];
      return Dexie.delete(NAME);
    };
  });

  it('stops writing and asks for the update when another tab upgrades the data', async () => {
    const tab = await running();
    const update = vi.fn();
    tab.whenOutdated(update);
    const upgraded = newer();
    await upgraded.open();
    expect(update).toHaveBeenCalledOnce();
    expect(tab.outdated).toBe(true);
    await expect(tab.workouts.put(workout('late') as never)).rejects.toThrow();
    await expect(tab.workouts.toArray()).rejects.toThrow();
    expect((await upgraded.table('workouts').toArray()).map((w) => w.id)).toEqual(['kept']);
  });

  it('stops a connection that opens onto newer data without having seen the upgrade', async () => {
    const upgraded = newer();
    await upgraded.table('workouts').put(workout('kept'));
    upgraded.close();
    const tab = new TrainingDB(NAME);
    open.push(tab);
    const update = vi.fn();
    tab.whenOutdated(update);
    await expect(tab.workouts.put(workout('late') as never)).rejects.toThrow();
    expect(update).toHaveBeenCalledOnce();
    await upgraded.open();
    expect((await upgraded.table('workouts').toArray()).map((w) => w.id)).toEqual(['kept']);
  });

  it('tells a screen that asks late', async () => {
    const tab = await running();
    await newer().open();
    const update = vi.fn();
    tab.whenOutdated(update);
    expect(update).toHaveBeenCalledOnce();
  });

  it('carries on through a change that’s still the same schema', async () => {
    const tab = await running();
    const update = vi.fn();
    tab.whenOutdated(update);
    const patched = newer(SCHEMA_VERSION + 0.1);
    await patched.open();
    patched.close();
    expect(update).not.toHaveBeenCalled();
    await tab.workouts.put(workout('later') as never);
    expect(await tab.workouts.count()).toBe(2);
  });
});

describe('safety copies', () => {
  it('keeps only the newest copies', async () => {
    await db.workouts.put(workout('a') as never);
    for (let i = 0; i < KEEP_COPIES + 2; i++) {
      await db.settings.put({ id: 'main', bodyWeightKg: i } as never);
      await saveCurrentCopy();
    }
    const copies = await listCopies();
    expect(copies).toHaveLength(KEEP_COPIES);
    expect(copies.map((c) => (c.tables.settings[0] as { bodyWeightKg: number }).bodyWeightKg)).toEqual([4, 3, 2]);
  });

  it('skips an empty database, so it can’t push out a useful copy', async () => {
    await saveCurrentCopy();
    expect(await listCopies()).toEqual([]);
  });

  it('restores a copy and keeps what it replaced', async () => {
    await db.workouts.put(workout('first') as never);
    await saveCurrentCopy();
    await db.workouts.clear();
    await db.workouts.put(workout('second') as never);
    const [copy] = await listCopies();
    await restoreCopy(copy.id!);
    expect((await db.workouts.toArray()).map((w) => w.id)).toEqual(['first']);
    const [undo] = await listCopies();
    expect((undo.tables.workouts[0] as { id: string }).id).toBe('second');
  });

  it('repairs what it can in a copy, and says how many rows it had to leave out', async () => {
    await db.workouts.put(workout('a') as never);
    await db.sets.bulkPut([{ id: 's', workoutId: 'a', exerciseId: 'plank' }, { id: 'bad', workoutId: 'a' }] as never);
    await saveCurrentCopy();
    const [copy] = await listCopies();
    await db.sets.clear();
    expect(await restoreCopy(copy.id!)).toBe(1);
    expect((await db.sets.toArray()).map((s) => [s.id, s.date])).toEqual([['s', '2026-02-03']]);
  });

  it('refuses a copy that doesn’t exist and changes nothing', async () => {
    await db.workouts.put(workout('a') as never);
    await expect(restoreCopy(99)).rejects.toThrow();
    expect(await db.workouts.count()).toBe(1);
  });
});

describe('normalizeTables', () => {
  it('fills defaults for fields an older version didn’t have', () => {
    const tables = normalizeTables({
      workouts: [{ id: 'w', date: '2026-01-01' }],
      sets: [{ id: 's', workoutId: 'w', exerciseId: 'plank', date: '2026-01-01' }],
    });
    expect(tables.workouts[0]).toMatchObject({ status: 'done', source: 'app', updatedAt: 0 });
    expect(tables.sets[0]).toMatchObject({ entry: 0, order: 0, kind: 'work', weightKg: 0, reps: 0, done: true });
    expect(tables.aliases).toEqual([]);
  });

  it('keeps failure and level on a set, and adds neither to a set without them', () => {
    const sets = [
      { id: 'a', workoutId: 'w', exerciseId: 'inverted-row', date: '2026-01-01', failure: true, level: 12 },
      { id: 'b', workoutId: 'w', exerciseId: 'inverted-row', date: '2026-01-01' },
    ];
    const [marked, plain] = normalizeTables({ sets }).sets as Record<string, unknown>[];
    expect(marked).toMatchObject({ failure: true, level: 12 });
    expect('failure' in plain || 'level' in plain).toBe(false);
  });

  it('leaves out rows that have no key, and keeps fields it doesn’t know', () => {
    const tables = normalizeTables({ workouts: [{ date: '2026-01-01' }, { id: 'w', date: '2026-01-01', later: 1 }] });
    expect(tables.workouts).toHaveLength(1);
    expect(tables.workouts[0]).toMatchObject({ id: 'w', later: 1 });
  });

  it('keeps rows from an older version as they were, title included', () => {
    const old = { id: 'w', date: '2026-01-01', title: 'Push', status: 'done', source: 'import', updatedAt: 1, rawText: 'text', sourceKey: 'k' };
    const set = { id: 's', workoutId: 'w', exerciseId: 'plank', date: '2026-01-01', entry: 1, order: 2, kind: 'warmup', weightKg: 2.5, reps: 6.5, seconds: 30, done: false, note: 'n' };
    const custom = { id: 'custom-a', names: { en: 'A', de: '', ru: '' }, muscle: 'legs', equipment: 'smith', load: 'time', compound: true, createdAt: 5, aliases: ['B'], levels: true };
    const tables = normalizeTables({ workouts: [old], sets: [set], customExercises: [custom] });
    expect(tables.workouts).toEqual([old]);
    expect(tables.sets).toEqual([set]);
    expect(tables.customExercises).toEqual([custom]);
  });

  it('gives a workout with no usable date the date of its sets', () => {
    const sets = [{ id: 's', workoutId: 'w', exerciseId: 'plank', date: '2026-01-05' }];
    expect(normalizeTables({ workouts: [{ id: 'w' }], sets }).workouts[0]).toMatchObject({ date: '2026-01-05' });
    expect(normalizeTables({ workouts: [{ id: 'w', date: 5 }], sets }).workouts[0]).toMatchObject({ date: '2026-01-05' });
  });

  it('gives a set with no date the date of its workout', () => {
    const tables = normalizeTables({ workouts: [{ id: 'w', date: '2026-01-05' }], sets: [{ id: 's', workoutId: 'w', exerciseId: 'plank' }] });
    expect(tables.sets[0]).toMatchObject({ date: '2026-01-05' });
  });

  it('leaves out what has no day to belong to, and only that', () => {
    const tables = normalizeTables({
      workouts: [{ id: 'gone' }, { id: 'bad', date: '2026-13-45' }, { id: 'w', date: '2026-01-05' }],
      sets: [
        { id: 'a', workoutId: 'gone', exerciseId: 'plank' },
        { id: 'b', exerciseId: 'plank', date: '2026-01-05' },
        { id: 'c', workoutId: 'w', date: '2026-01-05' },
        { id: 'd', workoutId: 'w', exerciseId: 'plank' },
      ],
    });
    expect(tables.workouts.map((w) => (w as { id: string }).id)).toEqual(['w']);
    expect(tables.sets.map((s) => (s as { id: string }).id)).toEqual(['d']);
  });

  it('counts what it left out', () => {
    const source = { workouts: [{ id: 'gone' }, { id: 'w', date: '2026-01-05' }], sets: [null], aliases: 'x' } as never;
    expect(droppedRows(source, normalizeTables(source))).toBe(2);
  });

  it('turns a custom exercise with only an id into one the screens can show', () => {
    const [row] = normalizeTables({ customExercises: [{ id: 'custom-x' }] }).customExercises;
    expect(row).toEqual({ id: 'custom-x', names: { en: 'custom-x', de: '', ru: '' }, muscle: 'fullBody', equipment: 'other', load: 'weight', compound: false, createdAt: 0 });
  });

  it('replaces values a custom exercise can’t use', () => {
    const odd = { id: 'custom-x', names: { en: 5, ru: 'Своё' }, muscle: 'tail', equipment: 'rope', load: 'hours', compound: 'yes', createdAt: 'then', aliases: 'x' };
    const [row] = normalizeTables({ customExercises: [odd] }).customExercises as Record<string, unknown>[];
    expect(row).toEqual({ id: 'custom-x', names: { en: '', de: '', ru: 'Своё' }, muscle: 'fullBody', equipment: 'other', load: 'weight', compound: false, createdAt: 0 });
  });

  it('replaces values a set can’t use, and drops optional ones', () => {
    const odd = { id: 's', workoutId: 'w', exerciseId: 'plank', date: '2026-01-01', entry: 'x', order: null, kind: 'huge', weightKg: 'heavy', reps: Infinity, seconds: '30', level: 'high', failure: 'yes', done: 'no', note: 5 };
    const [row] = normalizeTables({ sets: [odd] }).sets;
    expect(row).toEqual({ id: 's', workoutId: 'w', exerciseId: 'plank', date: '2026-01-01', entry: 0, order: 0, kind: 'work', weightKg: 0, reps: 0, done: true });
  });

  it('replaces values a workout can’t use', () => {
    const odd = { id: 'w', date: '2026-01-01', status: 'paused', source: 'cloud', updatedAt: 'now', note: 3, rawText: {}, startedAt: 'x' };
    expect(normalizeTables({ workouts: [odd] }).workouts).toEqual([{ id: 'w', date: '2026-01-01', status: 'done', source: 'app', updatedAt: 0 }]);
  });

  it('leaves out rows of other tables that can’t be used', () => {
    const tables = normalizeTables({
      aliases: [{ name: 'a' }, { name: 'b', exerciseId: 'plank' }],
      baselines: [{ id: 'a', exerciseId: 'plank' }, { id: 'b', exerciseId: 'plank', date: '2026-01-01' }],
      stallRecords: [{ id: 'a', exerciseId: 'plank', date: '2026-01-01' }, { id: 'b', exerciseId: 'plank', action: 'swap', date: '2026-01-01' }],
      exerciseSettings: [{ exerciseId: 'plank', stepKg: 'x', machineSetting: 5, repLow: 6 }],
    });
    expect(tables.aliases).toHaveLength(1);
    expect(tables.baselines).toHaveLength(1);
    expect(tables.stallRecords).toHaveLength(1);
    expect(tables.exerciseSettings).toEqual([{ exerciseId: 'plank', repLow: 6 }]);
  });
});

describe('isDay', () => {
  it.each(['2026-01-31', '2024-02-29', '2026-12-01'])('accepts %s', (day) => {
    expect(isDay(day)).toBe(true);
  });

  it.each(['2026-13-45', '2026-02-30', '2025-02-29', '2026-00-10', '2026-1-1', '8.01.26', '', null, 20260101])('refuses %s', (day) => {
    expect(isDay(day)).toBe(false);
  });
});
