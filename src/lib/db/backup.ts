import type { IndexableType } from 'dexie';
import { FileError, historyTables, isHistoryFile } from './historyFile';
import { db, SCHEMA_VERSION, USER_TABLES } from './schema';
import { droppedRows, normalizeTables, readAllTables, readInstalled, replaceAllTables, saveCurrentCopy, type TableRows } from './safety';
import { fmtDate } from '../dates';
import { t, tn } from '../i18n.svelte';
import type { Alias, Baseline, CustomExercise, ExerciseNote, ExerciseSettings, Settings, StallRecord, Workout, WorkoutSet } from '../types';

/**
 * A backup is one JSON file the user keeps somewhere safe. `version` is the schema version of the
 * data in it, so restoring reads an old file the same way as an old safety copy.
 */
export interface BackupFile {
  app: 'training';
  version: number;
  exportedAt: string;
  data: TableRows;
}

function backupBlob(version: number, data: TableRows): Blob {
  const file: BackupFile = { app: 'training', version, exportedAt: new Date().toISOString(), data };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function exportBackup(): Promise<Blob> {
  return backupBlob(SCHEMA_VERSION, await readAllTables());
}

/** A backup of the data as it is on this device, for when the app can't open it. */
export async function installedBackup(): Promise<Blob> {
  const { version, tables } = await readInstalled();
  return backupBlob(version, { workouts: [], sets: [], ...tables });
}

/** What happened to a backup file handed to shareOrDownload(). */
export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Save through the iOS share sheet (→ Files / iCloud Drive), or download as a fallback.
 * Resolves after the share sheet closes: 'shared' when the user picked a target,
 * 'cancelled' when they dismissed it, 'downloaded' when the download fallback ran
 * (no Web Share, or share() failed for another reason).
 */
export async function shareOrDownload(blob: Blob, filename: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export interface BackupContents {
  tables: TableRows;
  /** Rows the file holds that nothing can be done with, so they were left out. */
  dropped: number;
}

/**
 * Reads a backup of any older version. A bad row doesn't stop the rest, because this file may be
 * the only copy left of everything else. A file with no usable workouts at all is refused: it would
 * replace the user's data with nothing. Throws a message for the user when it can't be used.
 */
export function readBackup(text: string): BackupContents {
  let file: Partial<BackupFile> | null;
  try {
    file = JSON.parse(text);
  } catch {
    throw new FileError(t('settings.restore.notBackup'));
  }
  const data = file?.data;
  if (file?.app !== 'training' || !Number.isInteger(file.version) || !data || !Array.isArray(data.workouts) || !Array.isArray(data.sets)) {
    throw new FileError(t('settings.restore.notBackup'));
  }
  if (file.version! > SCHEMA_VERSION) throw new FileError(t('settings.restore.newer'));
  const tables = normalizeTables(data);
  if (data.workouts.length && !tables.workouts.length) throw new FileError(t('settings.restore.damaged'));
  // Restoring proves this backup exists, whatever the settings inside it knew when it was made.
  const madeAt = Math.min(Date.parse(file.exportedAt ?? ''), Date.now());
  for (const row of tables.settings as Settings[]) if (madeAt > row.lastBackupAt) row.lastBackupAt = madeAt;
  return { tables, dropped: droppedRows(data, tables) };
}

export function parseBackup(text: string): TableRows {
  return readBackup(text).tables;
}

/** A file's workouts as they ended up: added, or left out and why. */
export interface ImportResult {
  workouts: number;
  sets: number;
  /** Workouts left out, whatever the reason. */
  skipped: number;
  /** The days of the workouts left out, one per workout. */
  skippedDays: {
    /** The same workout is already in the app. */
    same: string[];
    /** The app has a different workout on that day. */
    other: string[];
    /** A workout is in progress: on that day, or the file's own is one and only one can run. */
    active: string[];
  };
  customExercises: number;
  notes: number;
  /** Rows the file holds that nothing can be done with. */
  dropped: number;
}

/** Days as a short list: a whole history left out stays one line. */
const DAYS_SHOWN = 3;

export function listDays(days: string[]): string {
  const sorted = [...new Set(days)].sort();
  const shown = sorted.slice(0, DAYS_SHOWN).map((day) => fmtDate(day)).join(', ');
  const more = sorted.length - DAYS_SHOWN;
  return more > 0 ? tn('import.done.moreDays', more, { days: shown }) : shown;
}

/** A history file, or a backup, which works the same for adding workouts. */
async function readImportFile(text: string): Promise<BackupContents> {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new FileError(t('import.notHistory'));
  }
  if (isHistoryFile(file)) {
    const saved = await db.customExercises.toArray();
    const moved = Array.isArray(file.gymChanges) && file.gymChanges.length > 0;
    const trained = moved ? await db.sets.filter((s) => s.done).toArray() : [];
    return { tables: normalizeTables(historyTables(file, saved, Date.now(), trained)), dropped: 0 };
  }
  try {
    return readBackup(text);
  } catch (e) {
    throw e instanceof FileError && e.message === t('settings.restore.notBackup') ? new FileError(t('import.notHistory')) : e;
  }
}

/** Rows whose key isn't stored yet: an import adds to what's there and changes nothing in it. */
async function newRows<T>(name: string, key: string, rows: unknown[]): Promise<T[]> {
  const stored = new Set(await db.table(name).toCollection().primaryKeys());
  return rows.filter((row) => !stored.has((row as Record<string, IndexableType>)[key])) as T[];
}

/** What an import would add, given what's stored now. Reads only. */
async function planImport(tables: TableRows) {
  const saved = await db.workouts.toArray();
  const ids = new Set(saved.map((w) => w.id));
  const onDay = new Map<string, Workout[]>();
  for (const w of saved) if (w.status !== 'planned') onDay.set(w.date, [...(onDay.get(w.date) ?? []), w]);
  // One active workout at a time: the app only ever finds the first, so a second would stay hidden.
  let running = saved.some((w) => w.status === 'active');

  const workouts: Workout[] = [];
  const skippedDays: ImportResult['skippedDays'] = { same: [], other: [], active: [] };
  for (const workout of tables.workouts as Workout[]) {
    const there = onDay.get(workout.date) ?? [];
    const sameSource = workout.sourceKey && there.some((w) => w.sourceKey === workout.sourceKey);
    if (ids.has(workout.id) || sameSource) skippedDays.same.push(workout.date);
    else if (there.some((w) => w.status === 'active') || (running && workout.status === 'active')) skippedDays.active.push(workout.date);
    else if (there.length) skippedDays.other.push(workout.date);
    else {
      workouts.push(workout);
      running ||= workout.status === 'active';
    }
  }

  const added = new Set(workouts.map((w) => w.id));
  const sets = (tables.sets as WorkoutSet[]).filter((s) => added.has(s.workoutId));
  const notes = (tables.exerciseNotes as ExerciseNote[]).filter((n) => added.has(n.workoutId));
  const used = new Set(sets.map((s) => s.exerciseId));
  const newExercises = await newRows<CustomExercise>('customExercises', 'id', tables.customExercises);
  const customExercises = newExercises.filter((c) => used.has(c.id));
  const unused = new Set(newExercises.filter((c) => !used.has(c.id)).map((c) => c.id));
  const needed = (rows: unknown[]) => rows.filter((row) => !unused.has((row as { exerciseId?: string }).exerciseId ?? ''));

  return {
    workouts,
    sets,
    notes,
    customExercises,
    aliases: await newRows<Alias>('aliases', 'name', needed(tables.aliases)),
    exerciseSettings: await newRows<ExerciseSettings>('exerciseSettings', 'exerciseId', needed(tables.exerciseSettings)),
    baselines: await newRows<Baseline>('baselines', 'id', needed(tables.baselines)),
    stallRecords: await newRows<StallRecord>('stallRecords', 'id', needed(tables.stallRecords)),
    skippedDays,
  };
}

/**
 * Adds a file's workouts to the ones on this device. A workout the app already has, or a day it
 * already has a workout for, stays as it is, so importing twice adds nothing. A custom exercise only
 * comes along with a workout that uses it. Settings are left alone. To swap everything for a file,
 * use restoreBackup().
 *
 * A safety copy lives in another database, so it can't join the transaction that adds the rows. It
 * only happens when there's something to add, and the plan is made again inside the transaction, in
 * case another tab changed the data while the copy was saved.
 */
export async function importHistory(text: string): Promise<ImportResult> {
  const { tables, dropped } = await readImportFile(text);
  const names = USER_TABLES.filter((name) => name !== 'settings');
  const scope = names.map((name) => db.table(name));
  const result = (plan: Awaited<ReturnType<typeof planImport>>): ImportResult => ({
    workouts: plan.workouts.length,
    sets: plan.sets.length,
    skipped: tables.workouts.length - plan.workouts.length,
    skippedDays: plan.skippedDays,
    customExercises: plan.customExercises.length,
    notes: plan.notes.length,
    dropped,
  });

  const planned = await db.transaction('r', scope, () => planImport(tables));
  const { skippedDays: _, ...additions } = planned;
  if (!Object.values(additions).some((rows) => rows.length)) return result(planned);

  await saveCurrentCopy();
  return db.transaction('rw', scope, async () => {
    const plan = await planImport(tables);
    await db.workouts.bulkAdd(plan.workouts);
    await db.sets.bulkAdd(plan.sets);
    await db.exerciseNotes.bulkAdd(plan.notes);
    await db.customExercises.bulkAdd(plan.customExercises);
    await db.aliases.bulkAdd(plan.aliases);
    await db.exerciseSettings.bulkAdd(plan.exerciseSettings);
    await db.baselines.bulkAdd(plan.baselines);
    await db.stallRecords.bulkAdd(plan.stallRecords);
    return result(plan);
  });
}

/**
 * Replaces everything on this device with the backup. The current data goes into a safety copy
 * first. The caller confirms with the user, then reloads settings.
 */
export async function applyBackup({ tables, dropped }: BackupContents): Promise<{ workouts: number; dropped: number }> {
  await saveCurrentCopy();
  await replaceAllTables(tables);
  return { workouts: tables.workouts.length, dropped };
}

export async function restoreBackup(text: string): Promise<{ workouts: number; dropped: number }> {
  return applyBackup(readBackup(text));
}
