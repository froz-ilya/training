import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backupFilename, DAY, daysSince, isBackupDue, isQuietMoment, NEVER_BACKED_UP_MIN_WORKOUTS, quietForUpdate, runBackup } from './backupReminder';
import { db, DB_NAME } from './db/schema';
import { defaultSettings, settings } from './settings.svelte';
import { ui } from './ui/dialogs.svelte';

const now = 1_000 * DAY;
const never = { backupEvery: 14, lastBackupAt: 0, backupSnoozeUntil: 0 };

describe('isBackupDue', () => {
  it('stays quiet with nothing to back up', () => {
    expect(isBackupDue(never, now, { workouts: 0, firstWorkoutAt: 0 })).toBe(false);
  });

  it('is off when the reminder is off', () => {
    expect(isBackupDue({ ...never, backupEvery: 0 }, now, { workouts: 50, firstWorkoutAt: 1 })).toBe(false);
  });

  it('waits out a snooze', () => {
    expect(isBackupDue({ ...never, backupSnoozeUntil: now + 1 }, now, { workouts: 50, firstWorkoutAt: 1 })).toBe(false);
  });

  it('never backed up: reminds once there is enough to lose', () => {
    const recent = now - DAY;
    expect(isBackupDue(never, now, { workouts: NEVER_BACKED_UP_MIN_WORKOUTS - 1, firstWorkoutAt: recent })).toBe(false);
    expect(isBackupDue(never, now, { workouts: NEVER_BACKED_UP_MIN_WORKOUTS, firstWorkoutAt: recent })).toBe(true);
  });

  it('never backed up: reminds once the data is old enough', () => {
    expect(isBackupDue(never, now, { workouts: 1, firstWorkoutAt: now - 14 * DAY })).toBe(true);
  });

  it('counts from the last backup', () => {
    const data = { workouts: 50, firstWorkoutAt: 1 };
    expect(isBackupDue({ ...never, lastBackupAt: now - 13 * DAY }, now, data)).toBe(false);
    expect(isBackupDue({ ...never, lastBackupAt: now - 14 * DAY }, now, data)).toBe(true);
  });
});

describe('helpers', () => {
  it('counts whole days and never goes negative', () => {
    expect(daysSince(now - DAY - 1, now)).toBe(1);
    expect(daysSince(now + DAY, now)).toBe(0);
  });

  it('names the file by date', () => {
    expect(backupFilename(new Date(2026, 2, 5))).toBe('training-backup-2026-03-05.json');
  });
});

describe('updating at a quiet moment', () => {
  const quiet = { path: '/', overlay: false, backingUp: false, activeWorkout: false };

  it.each(['/', '/history', '/progress', '/exercises'])('can reload on %s', (path) => {
    expect(isQuietMoment({ ...quiet, path })).toBe(true);
  });

  it.each(['/workout/1', '/import', '/settings', '/exercise/plank', '/group/legs'])('waits on %s', (path) => {
    expect(isQuietMoment({ ...quiet, path })).toBe(false);
  });

  it('waits out a workout in progress, wherever the user is', () => {
    expect(isQuietMoment({ ...quiet, activeWorkout: true })).toBe(false);
  });

  it('waits out an open sheet or dialog, which may hold unsaved text', () => {
    expect(isQuietMoment({ ...quiet, overlay: true })).toBe(false);
  });

  it('waits out a backup on its way to the share sheet', () => {
    expect(isQuietMoment({ ...quiet, backingUp: true })).toBe(false);
  });

  describe('as things stand', () => {
    beforeEach(async () => {
      db.close({ disableAutoOpen: false });
      await Dexie.delete(DB_NAME);
      ui.dialog = null;
    });

    it('is quiet with no workout going', async () => {
      await db.workouts.put({ id: 'w', date: '2026-01-01', status: 'done', source: 'app', updatedAt: 1 });
      expect(await quietForUpdate()).toBe(true);
    });

    it('sees a workout in progress in the database', async () => {
      await db.workouts.put({ id: 'w', date: '2026-01-01', status: 'active', source: 'app', updatedAt: 1 });
      expect(await quietForUpdate()).toBe(false);
    });

    it('sees an open dialog', async () => {
      ui.dialog = { kind: 'confirm', options: { title: 'x' }, resolve: () => {} };
      expect(await quietForUpdate()).toBe(false);
    });

    it('holds back when it can’t tell', async () => {
      const where = vi.spyOn(db.workouts, 'where').mockImplementation(() => {
        throw new Error('closed');
      });
      expect(await quietForUpdate()).toBe(false);
      where.mockRestore();
    });
  });

  it('leaves the moment to the app: the service worker never reloads the page by itself', () => {
    const config = readFileSync(join(import.meta.dirname, '../../vite.config.ts'), 'utf8');
    expect(config).toContain("registerType: 'prompt'");
  });
});

describe('runBackup', () => {
  const file = Promise.resolve(new Blob(['{}'], { type: 'application/json' }));

  beforeEach(async () => {
    db.close({ disableAutoOpen: false });
    await Dexie.delete(DB_NAME);
    Object.assign(settings, defaultSettings);
    ui.toasts = [];
    vi.stubGlobal('navigator', { canShare: () => true, share: () => Promise.resolve() });
    return () => vi.unstubAllGlobals();
  });

  it('records the date of a backup', async () => {
    expect(await runBackup(file)).toBe('shared');
    expect((await db.settings.get('main'))?.lastBackupAt).toBeGreaterThan(0);
    expect(ui.toasts.at(-1)?.message).toBe('Backup saved');
  });

  it('reports a backup as saved even when full storage can’t record the date', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transaction = vi.spyOn(db, 'transaction').mockRejectedValue(new Error('QuotaExceededError'));
    expect(await runBackup(file)).toBe('shared');
    expect(ui.toasts.at(-1)?.message).toBe('Backup saved');
    transaction.mockRestore();
    warn.mockRestore();
  });
});
