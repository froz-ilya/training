import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportBackup, listDays, parseBackup, readBackup, restoreBackup, importHistory } from './backup';
import { FileError, HISTORY_EXAMPLE } from './historyFile';
import { addExercise, createWorkout } from './repo';
import { listCopies, SAFETY_DB_NAME } from './safety';
import { db, DB_NAME, SCHEMA_VERSION } from './schema';
import { defaultSettings, loadSettings, normalizeSettings, saveSettings, settings } from '../settings.svelte';
import type { Settings, Workout, WorkoutSet } from '../types';

const workout: Workout = { id: 'w1', date: '2026-02-03', status: 'done', source: 'app', updatedAt: 1 };
const set: WorkoutSet = {
  id: 's1',
  workoutId: 'w1',
  exerciseId: 'deadlift',
  date: '2026-02-03',
  entry: 0,
  order: 0,
  kind: 'work',
  weightKg: 60,
  reps: 5,
  done: true,
};

beforeEach(async () => {
  db.close({ disableAutoOpen: false });
  await Dexie.delete(DB_NAME);
  await Dexie.delete(SAFETY_DB_NAME);
  Object.assign(settings, defaultSettings);
});

/** Blob.text() through a helper, so the test reads the file a user would get. */
const fileText = async () => (await exportBackup()).text();

describe('backup', () => {
  it('writes a versioned file with every table', async () => {
    await db.workouts.put(workout);
    const file = JSON.parse(await fileText());
    expect(file).toMatchObject({ app: 'training', version: SCHEMA_VERSION });
    expect(Date.parse(file.exportedAt)).not.toBeNaN();
    expect(Object.keys(file.data).sort()).toEqual(db.tables.map((t) => t.name).sort());
    expect(file.data.workouts).toEqual([workout]);
  });

  it('survives a round trip', async () => {
    await db.workouts.put(workout);
    await db.sets.put(set);
    await db.settings.put({ ...defaultSettings, bodyWeightKg: 72 });
    const text = await fileText();
    await db.workouts.clear();
    await db.sets.clear();
    await db.settings.clear();
    expect(await restoreBackup(text)).toEqual({ workouts: 1, dropped: 0 });
    expect(await db.workouts.toArray()).toEqual([workout]);
    expect(await db.sets.toArray()).toEqual([set]);
    await loadSettings();
    expect(settings.bodyWeightKg).toBe(72);
  });

  it('replaces what is there and saves a safety copy first', async () => {
    await db.workouts.put({ ...workout, id: 'current' });
    const text = JSON.stringify({ app: 'training', version: 1, exportedAt: '', data: { workouts: [workout], sets: [set] } });
    await restoreBackup(text);
    expect((await db.workouts.toArray()).map((w) => w.id)).toEqual(['w1']);
    const [copy] = await listCopies();
    expect((copy.tables.workouts[0] as Workout).id).toBe('current');
  });

  it('keeps the settings on this device when a backup has none', async () => {
    await db.settings.put({ ...defaultSettings, bodyWeightKg: 80 });
    await restoreBackup(JSON.stringify({ app: 'training', version: 1, exportedAt: '', data: { workouts: [], sets: [] } }));
    expect((await db.settings.get('main'))?.bodyWeightKg).toBe(80);
  });

  it('reads the oldest format with fields missing', async () => {
    const tables = parseBackup(
      JSON.stringify({
        app: 'training',
        version: 1,
        exportedAt: '',
        data: {
          workouts: [{ id: 'w', date: '2026-01-01' }],
          sets: [{ id: 's', workoutId: 'w', exerciseId: 'deadlift', date: '2026-01-01', weightKg: 50 }],
          settings: [{ id: 'main', theme: 'dark' }],
        },
      }),
    );
    expect(tables.workouts[0]).toMatchObject({ status: 'done' });
    expect(tables.sets[0]).toMatchObject({ weightKg: 50, kind: 'work', done: true });
    expect(tables.settings[0]).toMatchObject({ theme: 'dark', uiLang: 'auto', backupEvery: defaultSettings.backupEvery });
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['another app’s file', JSON.stringify({ app: 'deutsch', version: 1, data: { workouts: [], sets: [] } })],
    ['a file with no version', JSON.stringify({ app: 'training', data: { workouts: [], sets: [] } })],
    ['a file with no sets', JSON.stringify({ app: 'training', version: 1, data: { workouts: [] } })],
    ['null', 'null'],
  ])('rejects %s and changes nothing', async (_, text) => {
    await db.workouts.put(workout);
    await expect(restoreBackup(text)).rejects.toThrow('not a Training backup');
    expect(await db.workouts.count()).toBe(1);
    expect(await listCopies()).toEqual([]);
  });

  it('rejects a backup from a newer version', async () => {
    const text = JSON.stringify({ app: 'training', version: SCHEMA_VERSION + 1, data: { workouts: [], sets: [] } });
    await expect(restoreBackup(text)).rejects.toThrow('newer version');
  });

  it('leaves the data as it was when a restore fails halfway', async () => {
    await db.workouts.put(workout);
    const text = JSON.stringify({ app: 'training', version: 1, data: { workouts: [{ ...workout, id: 'new' }], sets: [set] } });
    // Inside a transaction Dexie hands out other Table objects, so this goes through the prototype.
    const table = Object.getPrototypeOf(db.sets) as typeof db.sets;
    const bulkPut = table.bulkPut as (...args: unknown[]) => Promise<unknown>;
    const put = vi.spyOn(table, 'bulkPut').mockImplementation(function (this: typeof db.sets, ...args: unknown[]) {
      return this.name === 'sets' ? Promise.reject(new Error('disk full')) : bulkPut.apply(this, args);
    } as never);
    await expect(restoreBackup(text)).rejects.toThrow('disk full');
    put.mockRestore();
    expect(await db.workouts.toArray()).toEqual([workout]);
  });
});

describe('backups with bad rows', () => {
  const backup = (data: object, extra: object = {}) => JSON.stringify({ app: 'training', version: 1, exportedAt: '', data: { workouts: [], sets: [], ...data }, ...extra });

  it('restores the good rows and says how many it left out', async () => {
    const text = backup({ workouts: [workout, { id: 'bad' }, null], sets: [set, { id: 'orphan' }] });
    expect(await restoreBackup(text)).toEqual({ workouts: 1, dropped: 3 });
    expect(await db.workouts.toArray()).toEqual([workout]);
    expect(await db.sets.toArray()).toEqual([set]);
  });

  it('keeps a workout whose date its sets can give back', async () => {
    const { date: _, ...undated } = workout;
    expect(await restoreBackup(backup({ workouts: [undated], sets: [set] }))).toEqual({ workouts: 1, dropped: 0 });
    expect(await db.workouts.get('w1')).toEqual(workout);
    expect(await db.workouts.where('date').equals('2026-02-03').count()).toBe(1);
  });

  it('keeps sets that point at a custom exercise with only an id', async () => {
    const custom = { ...set, exerciseId: 'custom-x' };
    await restoreBackup(backup({ workouts: [workout], sets: [custom], customExercises: [{ id: 'custom-x' }] }));
    expect(await db.sets.toArray()).toEqual([custom]);
    expect((await db.customExercises.get('custom-x'))?.names.en).toBe('custom-x');
  });

  it('refuses a backup with no usable workout, and keeps what’s on the device', async () => {
    await db.workouts.put({ ...workout, id: 'mine' });
    await expect(restoreBackup(backup({ workouts: [{ id: 'bad' }] }))).rejects.toThrow('damaged');
    expect((await db.workouts.toArray()).map((w) => w.id)).toEqual(['mine']);
    expect(await listCopies()).toEqual([]);
  });

  it('still restores an empty backup', async () => {
    expect(await restoreBackup(backup({}))).toEqual({ workouts: 0, dropped: 0 });
  });

  it('adds only the good rows of a backup through import, and says how many it left out', async () => {
    expect(await importHistory(backup({ workouts: [workout, { id: 'bad' }], sets: [set] }))).toMatchObject({ workouts: 1, dropped: 1 });
    expect(await db.workouts.count()).toBe(1);
  });

  it('validates without touching the data, for the Settings screen to check before it asks', async () => {
    await db.workouts.put({ ...workout, id: 'mine' });
    expect(readBackup(backup({ workouts: [workout], sets: [set] }))).toMatchObject({ dropped: 0 });
    expect(() => readBackup('not json')).toThrow(FileError);
    expect((await db.workouts.toArray()).map((w) => w.id)).toEqual(['mine']);
    expect(await listCopies()).toEqual([]);
  });
});

describe('the date of the last backup', () => {
  const backup = (lastBackupAt: number, exportedAt: string) =>
    JSON.stringify({ app: 'training', version: 1, exportedAt, data: { workouts: [workout], sets: [], settings: [{ ...defaultSettings, lastBackupAt }] } });
  const when = Date.parse('2026-02-03T10:00:00.000Z');

  it('counts a restored backup as a backup, however new it was', async () => {
    await restoreBackup(backup(0, new Date(when).toISOString()));
    expect((await db.settings.get('main'))?.lastBackupAt).toBe(when);
  });

  it('survives a real round trip', async () => {
    await db.workouts.put(workout);
    await db.settings.put({ ...defaultSettings });
    const text = await fileText();
    await restoreBackup(text);
    expect((await db.settings.get('main'))?.lastBackupAt).toBe(Date.parse(JSON.parse(text).exportedAt));
  });

  it('keeps a later date, ignores a file with no date, and never looks ahead', async () => {
    await restoreBackup(backup(when + 1000, new Date(when).toISOString()));
    expect((await db.settings.get('main'))?.lastBackupAt).toBe(when + 1000);
    await restoreBackup(backup(5, 'not a date'));
    expect((await db.settings.get('main'))?.lastBackupAt).toBe(5);
    await restoreBackup(backup(0, '2999-01-01T00:00:00.000Z'));
    expect((await db.settings.get('main'))?.lastBackupAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('saving settings from two tabs', () => {
  const row = () => db.settings.get('main');

  beforeEach(async () => {
    await db.settings.put({ ...defaultSettings, bodyWeightKg: 70 });
    await loadSettings();
  });

  it('keeps what another tab saved since this one read the row', async () => {
    await db.settings.put({ ...defaultSettings, bodyWeightKg: 90, theme: 'dark', lastBackupAt: 7 });
    settings.uiLang = 'de';
    await saveSettings();
    expect(await row()).toMatchObject({ uiLang: 'de', bodyWeightKg: 90, theme: 'dark', lastBackupAt: 7 });
  });

  it('catches up with what the other tab saved', async () => {
    await db.settings.put({ ...defaultSettings, bodyWeightKg: 90 });
    settings.uiLang = 'de';
    await saveSettings();
    expect(settings.bodyWeightKg).toBe(90);
  });

  it('doesn’t write a restored row over with old settings', async () => {
    await db.settings.put({ ...defaultSettings, customTags: [{ id: 'tag-1', label: 'Knee', offDay: true }] });
    settings.theme = 'light';
    await saveSettings();
    expect((await row())?.customTags).toHaveLength(1);
  });

  it('keeps a change made while a save is running', async () => {
    settings.theme = 'dark';
    const first = saveSettings();
    settings.theme = 'light';
    const second = saveSettings();
    await Promise.all([first, second]);
    expect(settings.theme).toBe('light');
    expect((await row())?.theme).toBe('light');
  });

  it('writes nothing when nothing changed', async () => {
    await db.settings.put({ ...defaultSettings, bodyWeightKg: 90 });
    await saveSettings();
    expect((await row())?.bodyWeightKg).toBe(90);
    expect(settings.bodyWeightKg).toBe(70);
  });

  it('creates the row on first use', async () => {
    await db.settings.clear();
    settings.theme = 'dark';
    await saveSettings();
    expect(await row()).toMatchObject({ theme: 'dark', backupEvery: defaultSettings.backupEvery });
  });
});

describe('comments in backups', () => {
  const v1Backup = (data: object) => JSON.stringify({ app: 'training', version: 1, exportedAt: '2026-01-01', data: { workouts: [workout], sets: [set], ...data } });

  it('restores a v1 backup, which has no comments', async () => {
    await db.exerciseNotes.put({ id: 'n0', workoutId: 'w0', exerciseId: 'deadlift', date: '2026-01-01', tags: [] });
    await restoreBackup(v1Backup({}));
    expect(await db.workouts.count()).toBe(1);
    expect(await db.exerciseNotes.count()).toBe(0);
  });

  it('carries comments through a backup', async () => {
    await db.workouts.put(workout);
    await db.sets.put(set);
    await db.exerciseNotes.put({ id: 'n1', workoutId: 'w1', exerciseId: 'deadlift', date: '2026-02-03', tags: ['pain'], text: 'knee' });
    const text = await (await exportBackup()).text();
    await db.exerciseNotes.clear();
    await restoreBackup(text);
    expect(await db.exerciseNotes.get('n1')).toMatchObject({ tags: ['pain'], text: 'knee' });
  });

  it('repairs comments with bad tags instead of failing', () => {
    const tables = parseBackup(JSON.stringify({ app: 'training', version: 1, exportedAt: '', data: { workouts: [], sets: [], exerciseNotes: [{ id: 'n', tags: 'x' }] } }));
    expect((tables.exerciseNotes[0] as { tags: string[] }).tags).toEqual([]);
  });
});

describe('normalizeSettings', () => {
  it('keeps valid custom tags and drops the rest', () => {
    const good = { id: 'tag-1', label: 'Knee', offDay: true };
    const odd = [good, { id: '', label: 'x' }, { id: 'tag-2', label: '  ' }, null, { id: 'tag-3', label: 'Flu', offDay: 'yes' }];
    expect(normalizeSettings({ customTags: odd as never }).customTags).toEqual([good, { id: 'tag-3', label: 'Flu', offDay: false }]);
    expect(normalizeSettings({ customTags: 'x' as never }).customTags).toEqual([]);
  });

  it('reads settings saved before workoutsPerWeek existed as automatic', () => {
    const { workoutsPerWeek: _, ...older } = defaultSettings;
    expect(normalizeSettings(older).workoutsPerWeek).toBe(0);
  });

  it('reads settings saved before regionGoals existed as no goals', () => {
    const { regionGoals: _, ...older } = defaultSettings;
    expect(normalizeSettings(older).regionGoals).toEqual({});
  });

  it('drops region goals it can’t read and keeps the rest', () => {
    const saved = { chest: 'focus', calves: 'ignore', lats: 'bulk', quads: 3 };
    expect(normalizeSettings({ regionGoals: saved as never }).regionGoals).toEqual({ chest: 'focus', calves: 'ignore' });
    expect(normalizeSettings({ regionGoals: 'x' as never }).regionGoals).toEqual({});
    expect(normalizeSettings({ regionGoals: ['focus'] as never }).regionGoals).toEqual({});
  });

  it('keeps the goal of a region this version doesn’t know', () => {
    const later = { neck: 'focus' } as Settings['regionGoals'];
    expect(normalizeSettings({ regionGoals: later }).regionGoals).toEqual(later);
  });

  it('keeps workoutsPerWeek within a week', () => {
    expect(normalizeSettings({ workoutsPerWeek: 3 }).workoutsPerWeek).toBe(3);
    expect(normalizeSettings({ workoutsPerWeek: 12 }).workoutsPerWeek).toBe(7);
    expect(normalizeSettings({ workoutsPerWeek: -1 }).workoutsPerWeek).toBe(0);
  });

  it('fills what is missing', () => {
    expect(normalizeSettings({ theme: 'light' })).toEqual({ ...defaultSettings, theme: 'light' });
    expect(normalizeSettings(null)).toEqual(defaultSettings);
  });

  it('replaces values it can’t use', () => {
    const odd = { uiLang: 'fr', exerciseLang: 3, theme: 'pink', bodyWeightKg: 'heavy', backupEvery: -1, lastBackupAt: NaN };
    expect(normalizeSettings(odd as unknown as Partial<Settings>)).toEqual(defaultSettings);
  });

  it('keeps fields a newer version added', () => {
    expect(normalizeSettings({ later: true } as Partial<Settings>)).toMatchObject({ later: true });
  });
});

describe('importHistory', () => {
  const file = (data: object) => JSON.stringify({ app: 'training', version: SCHEMA_VERSION, exportedAt: '', data: { workouts: [workout], sets: [set], ...data } });

  it('adds workouts, sets and comments to an empty app', async () => {
    const note = { id: 'n1', workoutId: workout.id, exerciseId: set.exerciseId, date: workout.date, tags: ['tired'] };
    expect(await importHistory(file({ exerciseNotes: [note] }))).toMatchObject({ workouts: 1, sets: 1, skipped: 0, customExercises: 0, notes: 1 });
    expect(await db.exerciseNotes.count()).toBe(1);
  });

  it('adds nothing the second time', async () => {
    await importHistory(file({}));
    expect(await importHistory(file({}))).toMatchObject({ workouts: 0, sets: 0, skipped: 1 });
    expect(await db.sets.count()).toBe(1);
  });

  it('keeps what the user logged on the same day', async () => {
    await db.workouts.put({ ...workout, id: 'logged', note: 'mine' });
    expect(await importHistory(file({}))).toMatchObject({ workouts: 0, skipped: 1 });
    expect((await db.workouts.get('logged'))?.note).toBe('mine');
  });

  it('leaves other workouts and settings alone', async () => {
    await db.workouts.put({ ...workout, id: 'older', date: '2020-01-01' });
    await importHistory(file({ settings: [{ id: 'main', theme: 'dark' }] }));
    expect(await db.workouts.count()).toBe(2);
    expect(await db.settings.count()).toBe(0);
  });

  it('refuses a file that isn’t Training data', async () => {
    await expect(importHistory('{"app":"other"}')).rejects.toThrow('history file');
  });

  it('saves no safety copy when nothing would be added', async () => {
    await db.workouts.put({ ...workout, id: 'logged' });
    expect(await importHistory(file({}))).toMatchObject({ workouts: 0, skipped: 1 });
    expect(await listCopies()).toEqual([]);
  });

  it('keeps earlier copies when the same file is imported again and again', async () => {
    await db.workouts.put({ ...workout, id: 'older', date: '2020-01-01' });
    await importHistory(file({}));
    const copies = await listCopies();
    expect(copies).toHaveLength(1);
    await importHistory(file({}));
    await importHistory(file({}));
    expect((await listCopies()).map((c) => c.id)).toEqual(copies.map((c) => c.id));
  });

  it('saves a copy when only a setting would be added', async () => {
    await db.workouts.put({ ...workout, id: 'logged' });
    await importHistory(file({ exerciseSettings: [{ exerciseId: 'plank', machineSetting: 'mat 2' }] }));
    expect(await listCopies()).toHaveLength(1);
    expect(await db.exerciseSettings.count()).toBe(1);
  });

  it('adds nothing when the copy fails', async () => {
    await db.workouts.put({ ...workout, id: 'older', date: '2020-01-01' });
    const table = Dexie.prototype.table;
    const full = vi.spyOn(Dexie.prototype, 'table').mockImplementation(function (this: Dexie, name: string) {
      if (this.name === SAFETY_DB_NAME) throw new Error('full');
      return table.call(this, name);
    } as never);
    await expect(importHistory(file({}))).rejects.toThrow('full');
    full.mockRestore();
    expect(await db.workouts.count()).toBe(1);
  });

  describe('workouts left out', () => {
    const on = (date: string, id = 'w-' + date) => ({ ...workout, id, date });

    it('tells a workout already in the app from a different one on that day', async () => {
      await db.workouts.bulkPut([on('2026-02-03', 'same'), on('2026-02-04', 'logged')]);
      const workouts = [on('2026-02-03', 'same'), on('2026-02-04')];
      const result = await importHistory(file({ workouts, sets: [] }));
      expect(result).toMatchObject({ skipped: 2, skippedDays: { same: ['2026-02-03'], other: ['2026-02-04'], active: [] } });
    });

    it('names today’s workout in progress as the reason', async () => {
      await db.workouts.put({ ...on('2026-02-03', 'running'), status: 'active' });
      const result = await importHistory(file({ workouts: [on('2026-02-03')], sets: [] }));
      expect(result).toMatchObject({ workouts: 0, skipped: 1, skippedDays: { same: [], other: [], active: ['2026-02-03'] } });
    });

    it('doesn’t count a planned workout as taking up the day', async () => {
      await db.workouts.put({ ...on('2026-02-03', 'plan'), status: 'planned' });
      expect(await importHistory(file({ workouts: [on('2026-02-03')], sets: [] }))).toMatchObject({ workouts: 1, skipped: 0 });
    });

    it('adds no second active workout from a backup', async () => {
      await db.workouts.put({ ...on('2026-02-03', 'running'), status: 'active' });
      const result = await importHistory(file({ workouts: [{ ...on('2026-01-01'), status: 'active' }], sets: [] }));
      expect(result).toMatchObject({ workouts: 0, skippedDays: { active: ['2026-01-01'] } });
      expect(await db.workouts.where('status').equals('active').count()).toBe(1);
    });

    it('adds at most one active workout from a backup', async () => {
      const workouts = [{ ...on('2026-01-01'), status: 'active' }, { ...on('2026-01-02'), status: 'active' }];
      expect(await importHistory(file({ workouts, sets: [] }))).toMatchObject({ workouts: 1, skipped: 1 });
      expect(await db.workouts.where('status').equals('active').count()).toBe(1);
    });

    it('keeps a long list of days short', () => {
      const days = ['2026-01-04', '2026-01-02', '2026-01-02', '2026-01-03', '2026-01-01', '2026-01-05'];
      expect(listDays(days)).toBe('1 Jan 2026, 2 Jan 2026, 3 Jan 2026 and 2 more');
      expect(listDays(['2026-01-01'])).toBe('1 Jan 2026');
    });
  });
});

describe('history files', () => {
  const history = (workouts: unknown, extra: object = {}) => JSON.stringify({ app: 'training', format: 'history', version: 1, workouts, ...extra });
  const day = {
    date: '2026-05-14',
    text: '14.05.2026 legs',
    exercises: [
      {
        exerciseId: 'leg-press',
        machineSetting: 'seat 8',
        comments: [{ tags: ['tired'], text: 'long day' }],
        sets: [{ kind: 'warmup', weightKg: 75, reps: 13 }, { weightKg: 125, reps: 9 }, { weightKg: 125, reps: 6.5 }],
      },
      { exerciseId: 'plank', sets: [{ seconds: 72 }] },
    ],
  };

  it('turns workouts, exercises and sets into stored rows', async () => {
    expect(await importHistory(history([day]))).toMatchObject({ workouts: 1, sets: 4, skipped: 0, customExercises: 0, notes: 1 });
    const [workout] = await db.workouts.toArray();
    expect(workout).toMatchObject({ date: '2026-05-14', status: 'done', source: 'import', rawText: '14.05.2026 legs' });
    const sets = await db.sets.where('workoutId').equals(workout.id).toArray();
    const press = sets.filter((s) => s.exerciseId === 'leg-press').sort((a, b) => a.order - b.order);
    expect(press.map((s) => [s.kind, s.weightKg, s.reps, s.entry])).toEqual([['warmup', 75, 13, 0], ['work', 125, 9, 0], ['work', 125, 6.5, 0]]);
    expect(sets.find((s) => s.exerciseId === 'plank')).toMatchObject({ seconds: 72, reps: 0, entry: 1, done: true });
    expect((await db.exerciseSettings.get('leg-press'))?.machineSetting).toBe('seat 8');
    expect((await db.exerciseNotes.toArray())[0]).toMatchObject({ exerciseId: 'leg-press', date: '2026-05-14', tags: ['tired'], text: 'long day' });
  });

  it('adds nothing when imported again', async () => {
    await importHistory(history([day]));
    expect(await importHistory(history([day]))).toMatchObject({ workouts: 0, skipped: 1 });
  });

  it('stores exercise settings from the file’s list, and keeps the user’s own', async () => {
    await db.exerciseSettings.put({ exerciseId: 'pec-deck', machineSetting: 'seat 2' });
    const settings = [
      { exerciseId: 'machine-chest-press', name: 'Chest press', machineSetting: 'seat 8' },
      { exerciseId: 'pec-deck', machineSetting: 'seat 9' },
      { exerciseId: 'no-such-exercise', machineSetting: 'seat 1' },
    ];
    await importHistory(history([], { exerciseSettings: settings }));
    expect(await db.exerciseSettings.get('machine-chest-press')).toEqual({ exerciseId: 'machine-chest-press', machineSetting: 'seat 8' });
    expect((await db.exerciseSettings.get('pec-deck'))?.machineSetting).toBe('seat 2');
    expect(await db.exerciseSettings.count()).toBe(2);
  });

  it('imports the example shown on the Import screen', async () => {
    const result = await importHistory(JSON.stringify(HISTORY_EXAMPLE));
    expect(result).toMatchObject({ workouts: 1, sets: 4, skipped: 0, customExercises: 0, notes: 1 });
    expect((await db.sets.toArray()).map((s) => s.exerciseId).sort()).toEqual(['leg-press', 'leg-press', 'leg-press', 'plank']);
    expect((await db.exerciseSettings.get('machine-chest-press'))?.machineSetting).toBe('Seat 8');
  });

  it('finds an exercise by its name in any language', async () => {
    const exercises = [{ name: 'Bankdrücken mit Langhantel', sets: [] }, { name: 'Жим штанги лёжа', sets: [{ weightKg: 60, reps: 8 }] }];
    await importHistory(history([{ date: '2026-01-01', exercises }]));
    expect((await db.sets.toArray())[0].exerciseId).toBe('barbell-bench-press');
    expect(await db.customExercises.count()).toBe(0);
  });

  it('makes one new exercise for a name it doesn’t know', async () => {
    const workouts = [
      { date: '2026-01-01', exercises: [{ name: 'Жим лёгкий', sets: [{ weightKg: 20, reps: 10 }] }] },
      { date: '2026-01-02', exercises: [{ name: 'жим легкий', sets: [{ weightKg: 22, reps: 10 }] }] },
    ];
    expect(await importHistory(history(workouts))).toMatchObject({ workouts: 2, customExercises: 1 });
    const [custom] = await db.customExercises.toArray();
    expect(custom.names.ru).toBe('Жим лёгкий');
    expect(new Set((await db.sets.toArray()).map((s) => s.exerciseId))).toEqual(new Set([custom.id]));
  });

  it('keeps the file’s own custom exercises', async () => {
    const custom = { id: 'custom-a', names: { en: '', de: '', ru: 'Своё' }, muscle: 'legs', equipment: 'other', load: 'weight', compound: false, createdAt: 1 };
    const workouts = [{ date: '2026-01-01', exercises: [{ exerciseId: 'custom-a', sets: [{ weightKg: 20, reps: 10 }] }] }];
    expect(await importHistory(history(workouts, { customExercises: [custom] }))).toMatchObject({ customExercises: 1 });
    expect((await db.sets.toArray())[0].exerciseId).toBe('custom-a');
  });

  it('joins an exercise logged in the app, whichever language the file names it in', async () => {
    const logged = (date: string, name: string) => ({ date, exercises: [{ name, sets: [{ weightKg: 60, reps: 8 }] }] });
    const id = await createWorkout({ date: '2026-01-01' });
    await addExercise(id, 'barbell-bench-press');
    await importHistory(history([logged('2026-01-02', 'Жим штанги лёжа'), logged('2026-01-03', 'Bankdrücken mit Langhantel')]));
    const sets = await db.sets.toArray();
    expect(new Set(sets.map((s) => s.date))).toEqual(new Set(['2026-01-01', '2026-01-02', '2026-01-03']));
    expect(new Set(sets.map((s) => s.exerciseId))).toEqual(new Set(['barbell-bench-press']));
  });

  it('uses a custom exercise already on the device, by any of its names', async () => {
    const saved = { id: 'custom-mine', names: { en: 'Band pull', de: '', ru: 'Тяга резинки' }, muscle: 'back', equipment: 'other', load: 'weight', compound: false, createdAt: 1 } as const;
    await db.customExercises.put(saved);
    const workouts = [
      { date: '2026-01-01', exercises: [{ name: 'тяга резинки', sets: [{ weightKg: 5, reps: 10 }] }] },
      { date: '2026-01-02', exercises: [{ name: 'Band pull', sets: [{ weightKg: 6, reps: 10 }] }] },
    ];
    expect(await importHistory(history(workouts))).toMatchObject({ workouts: 2, customExercises: 0 });
    expect(new Set((await db.sets.toArray()).map((s) => s.exerciseId))).toEqual(new Set(['custom-mine']));
    expect(await db.customExercises.count()).toBe(1);
  });

  it('prefers the device’s custom exercise to one listed in the file under the same name', async () => {
    const custom = (id: string) => ({ id, names: { en: '', de: '', ru: 'Своё' }, muscle: 'legs', equipment: 'other', load: 'weight', compound: false, createdAt: 1 }) as const;
    await db.customExercises.put(custom('custom-device'));
    const workouts = [{ date: '2026-01-01', exercises: [{ exerciseId: 'custom-file', sets: [{ weightKg: 20, reps: 10 }] }] }];
    const settings = [{ exerciseId: 'custom-file', machineSetting: 'seat 3' }];
    expect(await importHistory(history(workouts, { customExercises: [custom('custom-file')], exerciseSettings: settings }))).toMatchObject({ customExercises: 0 });
    expect((await db.sets.toArray())[0].exerciseId).toBe('custom-device');
    expect((await db.exerciseSettings.get('custom-device'))?.machineSetting).toBe('seat 3');
    expect(await db.customExercises.count()).toBe(1);
  });

  it('adds no duplicate exercises when imported again', async () => {
    const workouts = [{ date: '2026-01-01', exercises: [{ name: 'Жим лёгкий', sets: [{ weightKg: 20, reps: 10 }] }] }];
    expect(await importHistory(history(workouts))).toMatchObject({ customExercises: 1 });
    expect(await importHistory(history(workouts))).toMatchObject({ workouts: 0, customExercises: 0 });
    expect(await db.customExercises.count()).toBe(1);
  });

  it('adds no exercise that only appears on a day the app already has', async () => {
    await db.workouts.put({ ...workout, id: 'logged', date: '2026-01-01' });
    const workouts = [{ date: '2026-01-01', exercises: [{ name: 'Жим лёгкий', machineSetting: 'seat 1', sets: [{ weightKg: 20, reps: 10 }] }] }];
    expect(await importHistory(history(workouts))).toMatchObject({ workouts: 0, customExercises: 0 });
    expect(await db.customExercises.count()).toBe(0);
    expect(await db.exerciseSettings.count()).toBe(0);
  });

  it.each([
    ['a bad date', [{ date: '8.01.26', exercises: [] }]],
    ['an exercise with no sets list', [{ date: '2026-01-01', exercises: [{ exerciseId: 'plank' }] }]],
    ['an exercise with no name', [{ date: '2026-01-01', exercises: [{ sets: [] }] }]],
  ])('refuses %s', async (_, workouts) => {
    await expect(importHistory(history(workouts))).rejects.toThrow();
    expect(await db.workouts.count()).toBe(0);
  });

  it('refuses a file from a newer version, and doesn’t call it a backup', async () => {
    const newer = expect(importHistory(JSON.stringify({ app: 'training', format: 'history', version: 99, workouts: [] }))).rejects;
    await newer.toThrow('This file comes from a newer version');
  });

  it('calls a newer backup a backup', async () => {
    const newer = JSON.stringify({ app: 'training', version: SCHEMA_VERSION + 1, data: { workouts: [], sets: [] } });
    await expect(importHistory(newer)).rejects.toThrow('This backup comes from a newer version');
  });

  describe('files it can’t use', () => {
    const inSet = (set: unknown) => [{ date: '2026-01-01', exercises: [{ name: 'Plank', sets: [set] }] }];
    const inExercise = (fields: object) => [{ date: '2026-01-01', exercises: [{ name: 'Plank', sets: [], ...fields }] }];
    const refused = async (text: string, message: string | RegExp) => {
      const error = await importHistory(text).catch((e) => e);
      expect(error).toBeInstanceOf(FileError);
      expect(error.message).toMatch(message);
      expect(await db.workouts.count()).toBe(0);
    };

    it.each(['2026-13-45', '2026-02-30', '2025-02-29', '2026-00-01'])('refuses the impossible date %s', async (date) => {
      await refused(history([{ date, exercises: [] }]), date);
    });

    it('refuses an impossible date in a gym change', async () => {
      await refused(history([], { gymChanges: [{ date: '2026-02-30' }] }), '2026-02-30');
    });

    it.each([
      ['weightKg', 'a string', '60'],
      ['weightKg', 'a negative', -5],
      ['weightKg', 'infinity', Infinity],
      ['reps', 'a string', 'ten'],
      ['reps', 'a negative', -1],
      ['seconds', 'a string', '30'],
      ['seconds', 'a negative', -30],
    ])('refuses %s as %s', async (field, _, value) => {
      await refused(history(inSet({ [field]: value })).replace('null', '1e999'), new RegExp(`Plank, set 1: ${field} has to be a number`));
    });

    it.each([0, -1, 1.5, '3'])('refuses level %s', async (level) => {
      await refused(history(inSet({ reps: 10, level })), /level has to be a whole number/);
    });

    it('still takes decimals, zero and nulls where they mean something', async () => {
      const sets = [{ weightKg: 22.5, reps: 6.5 }, { weightKg: 0, reps: 0 }, { weightKg: null, reps: 8, seconds: null, level: null }];
      await importHistory(history([{ date: '2026-01-01', exercises: [{ name: 'Plank', sets }] }]));
      const rows = (await db.sets.toArray()).sort((a, b) => a.order - b.order);
      expect(rows.map((s) => [s.weightKg, s.reps])).toEqual([[22.5, 6.5], [0, 0], [0, 8]]);
      expect('seconds' in rows[2] || 'level' in rows[2]).toBe(false);
    });

    it.each([
      ['a null set', history(inSet(null)), 'sets'],
      ['comments that aren’t a list', history(inExercise({ comments: {} })), 'comments'],
      ['a null comment', history(inExercise({ comments: [null] })), 'comments'],
      ['tags that aren’t text', history(inExercise({ comments: [{ tags: [1] }] })), 'tags'],
      ['a numeric name', history([{ date: '2026-01-01', exercises: [{ name: 5, sets: [] }] }]), 'name'],
      ['a blank name', history([{ date: '2026-01-01', exercises: [{ name: '  ', sets: [] }] }]), 'name'],
      ['a numeric id', history([{ date: '2026-01-01', exercises: [{ exerciseId: 5, sets: [] }] }]), 'exerciseId'],
      ['a null exercise', history([{ date: '2026-01-01', exercises: [null] }]), 'exercises'],
      ['a custom exercise without names', history([], { customExercises: [{ id: 'custom-a' }] }), 'names'],
      ['a custom exercise without an id', history([], { customExercises: [{ names: { en: 'A' } }] }), 'id'],
      ['custom exercises that aren’t a list', history([], { customExercises: {} }), 'id'],
      ['a null setting', history([], { exerciseSettings: [null] }), 'exerciseId'],
      ['a setting with no exercise', history([], { exerciseSettings: [{ machineSetting: 'x' }] }), 'name'],
      ['a setting with a bad step', history([], { exerciseSettings: [{ name: 'Plank', stepKg: 'big' }] }), 'stepKg'],
      ['a setting with a bad goal', history([], { exerciseSettings: [{ name: 'Plank', goal: 'win' }] }), 'goal'],
      ['a note that isn’t text', history([{ date: '2026-01-01', note: 5, exercises: [] }]), 'note'],
      ['a machine setting that isn’t text', history(inExercise({ machineSetting: 5 })), 'machineSetting'],
    ])('explains %s in the user’s words', async (_, text, field) => {
      await refused(text, field);
      await expect(importHistory(text)).rejects.not.toThrow(/undefined|Cannot|not a function|not iterable/);
    });

    it('says where the problem is, in the user’s language', async () => {
      const { setUiLang } = await import('../i18n.svelte');
      setUiLang('ru');
      await refused(history(inSet({ weightKg: 'x' })), /подход 1: weightKg должно быть числом/);
      setUiLang('en');
    });
  });

  describe('comments', () => {
    const noted = (comments: unknown) => history([{ date: '2026-01-01', exercises: [{ exerciseId: 'plank', comments, sets: [{ seconds: 30 }] }] }]);

    it('keeps a comment written as plain text', async () => {
      await importHistory(noted(['felt strong']));
      expect((await db.exerciseNotes.toArray())[0]).toMatchObject({ tags: [], text: 'felt strong' });
    });

    it('keeps a single tag', async () => {
      await importHistory(noted([{ tags: 'pain', text: 'knee' }]));
      expect((await db.exerciseNotes.toArray())[0]).toMatchObject({ tags: ['pain'], text: 'knee' });
    });

    it('stores no empty comments', async () => {
      expect(await importHistory(noted([{}, { tags: [] }, '', { text: '  ' }]))).toMatchObject({ notes: 0 });
    });
  });

  it('joins the device’s exercise when a name only the file knows leads to it', async () => {
    const device = { id: 'custom-device', names: { en: 'Sled push', de: '', ru: '' }, muscle: 'legs', equipment: 'other', load: 'weight', compound: false, createdAt: 1 } as const;
    await db.customExercises.put(device);
    const listed = { ...device, id: 'custom-file', names: { en: 'Sled push', de: '', ru: 'Толкание саней' } };
    const workouts = [{ date: '2026-01-01', exercises: [{ name: 'Толкание саней', sets: [{ weightKg: 40, reps: 10 }] }] }];
    expect(await importHistory(history(workouts, { customExercises: [listed] }))).toMatchObject({ customExercises: 0 });
    expect((await db.sets.toArray())[0].exerciseId).toBe('custom-device');
    expect(await db.customExercises.count()).toBe(1);
  });

  describe('how a new exercise is measured', () => {
    const sets = (...lists: object[][]) => lists.map((list, i) => ({ date: `2026-01-0${i + 1}`, exercises: [{ name: 'Жим лёгкий', sets: list }] }));
    const load = async (workouts: unknown) => {
      await importHistory(history(workouts));
      return (await db.customExercises.toArray())[0].load;
    };

    it('reads every workout, not just the first', async () => {
      expect(await load(sets([{ reps: 10 }], [{ weightKg: 10, reps: 10 }]))).toBe('weight');
    });

    it('stays bodyweight when no set has weight', async () => {
      expect(await load(sets([{ reps: 10 }], [{ reps: 12 }]))).toBe('body');
    });

    it('is timed when any set is', async () => {
      expect(await load(sets([{ reps: 1 }], [{ seconds: 30 }]))).toBe('time');
    });
  });

  it('stores a setting for an exercise that only has a name', async () => {
    const exerciseSettings = [
      { name: 'Жим штанги лёжа', machineSetting: 'rack 4' },
      { name: 'Новое упражнение', machineSetting: 'seat 2' },
      { name: 'Никем не использовано', machineSetting: 'seat 9' },
    ];
    await importHistory(history([{ date: '2026-01-01', exercises: [{ name: 'Новое упражнение', sets: [{ weightKg: 5, reps: 5 }] }] }], { exerciseSettings }));
    const [custom] = await db.customExercises.toArray();
    expect((await db.exerciseSettings.get('barbell-bench-press'))?.machineSetting).toBe('rack 4');
    expect((await db.exerciseSettings.get(custom.id))?.machineSetting).toBe('seat 2');
    expect(await db.exerciseSettings.count()).toBe(2);
    expect(await db.customExercises.count()).toBe(1);
  });

  it('stores failure and level when given, and adds neither otherwise', async () => {
    const sets = [{ reps: 10, level: 12, failure: true }, { reps: 8 }];
    await importHistory(history([{ date: '2026-01-01', exercises: [{ exerciseId: 'inverted-row', sets }] }]));
    const rows = (await db.sets.toArray()).sort((a, b) => a.order - b.order);
    expect(rows[0]).toMatchObject({ level: 12, failure: true });
    expect('level' in rows[1] || 'failure' in rows[1]).toBe(false);
  });

  describe('gym changes', () => {
    const train = (date: string, ...ids: string[]) => ({ date, exercises: ids.map((exerciseId) => ({ exerciseId, sets: [{ weightKg: 40, reps: 10 }] })) });
    const workouts = [train('2026-01-01', 'leg-press', 'seated-cable-row', 'smith-squat', 'barbell-bench-press', 'incline-dumbbell-press'), train('2026-03-01', 'lat-pulldown')];
    const moved = { gymChanges: [{ date: '2026-02-01', note: 'New gym' }] };
    const custom = { id: 'custom-a', names: { en: '', de: '', ru: 'Своё' }, muscle: 'legs', equipment: 'machine', load: 'weight', compound: false, createdAt: 1 };

    it('restarts comparisons for machine, cable and Smith exercises trained before it', async () => {
      await importHistory(history(workouts, moved));
      const rows = await db.baselines.toArray();
      expect(rows.map((b) => b.exerciseId).sort()).toEqual(['leg-press', 'seated-cable-row', 'smith-squat']);
      expect(rows[0]).toMatchObject({ date: '2026-02-01', note: 'New gym' });
    });

    it('doesn’t count a set on the day of the move as before it', async () => {
      await importHistory(history(workouts, { gymChanges: [{ date: '2026-01-01' }] }));
      expect(await db.baselines.count()).toBe(0);
    });

    it('adds nothing when imported again', async () => {
      await importHistory(history(workouts, moved));
      await importHistory(history(workouts, moved));
      expect(await db.baselines.count()).toBe(3);
    });

    it('adds a move to workouts that were imported earlier', async () => {
      await importHistory(history(workouts));
      expect(await db.baselines.count()).toBe(0);
      await importHistory(history(workouts, moved));
      expect(await db.baselines.count()).toBe(3);
    });

    it('covers a custom exercise, by its own equipment', async () => {
      await importHistory(history([train('2026-01-01', 'custom-a')], { ...moved, customExercises: [custom] }));
      expect((await db.baselines.toArray()).map((b) => b.exerciseId)).toEqual(['custom-a']);
    });

    it('leaves out a custom exercise that wasn’t added', async () => {
      await db.workouts.put({ ...workout, id: 'logged', date: '2026-01-01' });
      await importHistory(history([train('2026-01-01', 'custom-a')], { ...moved, customExercises: [custom] }));
      expect(await db.baselines.count()).toBe(0);
    });

    it('covers exercises trained only on this device before the move', async () => {
      await importHistory(history([train('2026-01-01', 'leg-press')]));
      await importHistory(history([train('2026-03-01', 'lat-pulldown')], moved));
      expect((await db.baselines.toArray()).map((b) => b.exerciseId)).toEqual(['leg-press']);
    });

    it('counts sets logged in the app, not planned ones', async () => {
      const base = { workoutId: 'x', date: '2026-01-01', entry: 0, order: 0, kind: 'work', weightKg: 40, reps: 8 } as const;
      await db.sets.bulkPut([{ ...base, id: 'a', exerciseId: 'leg-press', done: true }, { ...base, id: 'b', exerciseId: 'seated-cable-row', done: false }]);
      await importHistory(history([], moved));
      expect((await db.baselines.toArray()).map((b) => b.exerciseId)).toEqual(['leg-press']);
    });

    it('refuses a move with a bad date', async () => {
      await expect(importHistory(history(workouts, { gymChanges: [{ date: 'Feb 2026' }] }))).rejects.toThrow();
      await expect(importHistory(history(workouts, { gymChanges: 'soon' }))).rejects.toThrow();
      expect(await db.workouts.count()).toBe(0);
    });
  });
});
