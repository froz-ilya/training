import { db } from './db/schema';
import { exportBackup, shareOrDownload, type ShareResult } from './db/backup';
import { fromISODate } from './dates';
import { t, tn } from './i18n.svelte';
import { route } from './router.svelte';
import { saveSettings, settings } from './settings.svelte';
import { confirmAction, showToast, ui } from './ui/dialogs.svelte';
import { hasOverlay } from './ui/overlay';
import type { Settings } from './types';

/**
 * Backup reminder: a pop-up on launch when the last backup is older than
 * settings.backupEvery days, plus runBackup() for the "Back up now" button.
 */

export const DAY = 24 * 60 * 60 * 1000;

/** Never backed up: remind once this many workouts would be lost. */
export const NEVER_BACKED_UP_MIN_WORKOUTS = 5;

export interface DataInfo {
  /** Finished workouts (0 = nothing to back up). */
  workouts: number;
  /** Time of the oldest workout (epoch ms; 0 when unknown). */
  firstWorkoutAt: number;
}

type ReminderSettings = Pick<Settings, 'backupEvery' | 'lastBackupAt' | 'backupSnoozeUntil'>;

/** Whole days between ts and now (never negative). */
export function daysSince(ts: number, now: number): number {
  return Math.max(0, Math.floor((now - ts) / DAY));
}

/** Pure: should the backup reminder be shown now? */
export function isBackupDue(s: ReminderSettings, now: number, data: DataInfo): boolean {
  const every = s.backupEvery;
  if (!every || every <= 0) return false;
  if (data.workouts <= 0) return false;
  if (now < (s.backupSnoozeUntil || 0)) return false;
  if (!s.lastBackupAt) {
    // Never backed up: wait until the data has existed for a while or there's enough to lose.
    const age = data.firstWorkoutAt ? now - data.firstWorkoutAt : 0;
    return age >= every * DAY || data.workouts >= NEVER_BACKED_UP_MIN_WORKOUTS;
  }
  return now - s.lastBackupAt >= every * DAY;
}

/** "Last backup: …" wording for Settings. */
export function lastBackupLabel(lastBackupAt: number, now = Date.now()): string {
  if (!lastBackupAt) return t('settings.backup.never');
  const d = daysSince(lastBackupAt, now);
  if (d === 0) return t('settings.backup.today');
  if (d === 1) return t('settings.backup.yesterday');
  return tn('settings.backup.daysAgo', d);
}

/** The same as a sentence for the reminder pop-up. */
function lastBackupSentence(lastBackupAt: number, now: number): string {
  const d = daysSince(lastBackupAt, now);
  if (d === 0) return t('settings.backup.reminderToday');
  if (d === 1) return t('settings.backup.reminderYesterday');
  return tn('settings.backup.reminderDaysAgo', d);
}

export function backupFilename(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `training-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

async function dataInfo(): Promise<DataInfo> {
  const workouts = await db.workouts.where('status').equals('done').count();
  if (!workouts) return { workouts: 0, firstWorkoutAt: 0 };
  const first = await db.workouts.orderBy('date').first();
  return { workouts, firstWorkoutAt: first ? fromISODate(first.date).getTime() : 0 };
}

export type BackupResult = ShareResult | 'failed';

let running = false;

/**
 * Export a backup and hand it to the share sheet (or download it). On success records
 * lastBackupAt, clears the snooze and toasts "Backup saved". A cancelled share sheet
 * changes nothing. Pass a pre-built blob promise to keep the share call close to the tap
 * (iOS needs share() to run soon after the user gesture).
 */
export async function runBackup(prepared?: Promise<Blob>): Promise<BackupResult> {
  if (running) return 'cancelled';
  running = true;
  try {
    const blob = await (prepared ?? exportBackup());
    const result = await shareOrDownload(blob, backupFilename());
    if (result !== 'cancelled') {
      settings.lastBackupAt = Date.now();
      settings.backupSnoozeUntil = 0;
      // The file is safe by now, whether or not this date can be stored: storage may just be full.
      await saveSettings().catch((e) => console.warn('backup date not saved', e));
      showToast(t('settings.backup.saved'));
    }
    return result;
  } catch (e) {
    console.error('backup failed', e);
    showToast(t('settings.backup.failed', { error: (e as Error).message }));
    return 'failed';
  } finally {
    running = false;
  }
}

async function snooze(now: number) {
  settings.backupSnoozeUntil = now + DAY;
  await saveSettings();
}

/** Routes where a pop-up would interrupt the user: logging a workout, or an import in progress. */
const BUSY_ROUTES = ['/workout', '/import'];
const FIRST_DELAY = 1500;
const RETRY_DELAY = 5000;
/** Give up waiting for a quiet moment after this long (try again next launch). */
const MAX_WAIT = 30 * 60 * 1000;

/** Pages a reload costs nothing on. Everything else can hold work in progress, or a file picker. */
const QUIET_ROUTES = ['/', '/history', '/progress', '/exercises'];

export interface Moment {
  path: string;
  /** A dialog or sheet is open: it may hold text that isn't saved yet. */
  overlay: boolean;
  /** A backup is on its way to the share sheet. */
  backingUp: boolean;
  activeWorkout: boolean;
}

/** Pure: can the page reload for an update right now without costing the user anything? */
export function isQuietMoment(moment: Moment): boolean {
  return QUIET_ROUTES.includes(moment.path) && !moment.overlay && !moment.backingUp && !moment.activeWorkout;
}

/** What isQuietMoment() needs to know, as things stand. */
export async function quietForUpdate(): Promise<boolean> {
  const moment = () => ({ path: route.path, overlay: !!ui.dialog || hasOverlay(), backingUp: running });
  if (!isQuietMoment({ ...moment(), activeWorkout: false })) return false;
  try {
    const active = await db.workouts.where('status').equals('active').count();
    return isQuietMoment({ ...moment(), activeWorkout: active > 0 });
  } catch {
    return false;
  }
}

let started = false;

function isBusy(): boolean {
  if (ui.dialog) return true;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return true;
  return BUSY_ROUTES.some((p) => route.path === p || route.path.startsWith(`${p}/`));
}

/**
 * Call once after the app mounts. Waits ~1.5 s so the first screen renders, waits out
 * workouts and open dialogs, then shows the reminder if a backup is due.
 * Shows at most once per app launch.
 */
export function checkBackupReminder(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const startedAt = Date.now();

  const attempt = async () => {
    if (isBusy()) {
      if (Date.now() - startedAt < MAX_WAIT) setTimeout(() => void attempt(), RETRY_DELAY);
      return;
    }
    const now = Date.now();
    let info: DataInfo;
    try {
      info = await dataInfo();
    } catch (e) {
      console.warn('backup reminder: data check failed', e);
      return;
    }
    if (!isBackupDue(settings, now, info)) return;
    // A dialog or workout may have opened while we were reading the database.
    if (isBusy()) {
      if (Date.now() - startedAt < MAX_WAIT) setTimeout(() => void attempt(), RETRY_DELAY);
      return;
    }
    await showReminder(now);
  };

  setTimeout(() => void attempt(), FIRST_DELAY);
}

async function showReminder(now: number) {
  const message = settings.lastBackupAt
    ? lastBackupSentence(settings.lastBackupAt, now)
    : t('settings.backup.reminderFirst');
  // Build the backup while the pop-up is open, so "Back up now" can open the share sheet
  // right away (iOS drops the user gesture if share() waits on IndexedDB first).
  const prepared = exportBackup();
  prepared.catch(() => {}); // surfaced by runBackup if used
  const ok = await confirmAction({
    title: t('settings.backup.reminderTitle'),
    message,
    confirmLabel: t('settings.backup.now'),
    cancelLabel: t('common.later'),
  });
  if (!ok) {
    await snooze(now);
    return;
  }
  const result = await runBackup(prepared);
  // Cancelled share sheet: don't nag again for a day either; lastBackupAt stays unchanged.
  if (result === 'cancelled' || result === 'failed') await snooze(Date.now());
}
