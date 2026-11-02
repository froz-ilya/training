import Dexie from 'dexie';
import { db, DB_NAME, SCHEMA_VERSION, schemaVersionOf, USER_TABLES } from './schema';
import { MUSCLES } from '../catalog/exercises';
import { toISODate } from '../dates';
import { normalizeSettings } from '../settings.svelte';
import type {
  Alias,
  Baseline,
  BodyWeight,
  CustomExercise,
  Equipment,
  ExerciseNote,
  ExerciseSettings,
  Load,
  Settings,
  StallRecord,
  Workout,
  WorkoutSet,
} from '../types';

export { schemaVersionOf };

/**
 * Runs before the main database opens, and before anything replaces the user's data.
 *
 * - Stored data newer than this code (an old cached app after an update): the app must not touch
 *   it, so startup stops and asks the user to update.
 * - Stored data older than this code: a schema upgrade is about to run, so a copy of everything
 *   goes into a separate database first. If an upgrade ever goes wrong, the copy can be restored
 *   from Settings.
 * - The copy can't be saved, most likely on a full disk: the upgrade doesn't run on its own, because
 *   the rule is a copy first. It can't simply refuse either, or a phone that's out of space would
 *   lock its owner out of their data. So preflight() reports 'copy-failed', with nothing changed
 *   yet, and main.ts asks: try again, save a backup file from the data as it is, or go on without a
 *   copy. A schema upgrade is one transaction, so even then a failure leaves the data as it was.
 *
 * Copies protect against a bad upgrade or a wrong restore. They live in the same browser storage
 * as the data, so deleting the app deletes them too: only a backup file survives that.
 */

export const SAFETY_DB_NAME = 'training-safety';
/** Copies kept; older ones are dropped. */
export const KEEP_COPIES = 3;

export type TableRows = Record<string, unknown[]>;

export interface SafetyCopy {
  id?: number;
  /** Schema version of the data in the copy. */
  version: number;
  createdAt: number;
  /** Table name → rows. */
  tables: TableRows;
}

function safetyDb(): Dexie {
  const safety = new Dexie(SAFETY_DB_NAME);
  safety.version(1).stores({ copies: '++id' });
  return safety;
}

/** The schema version of the data on this device; null when there's none yet. */
async function installedVersion(): Promise<number | null> {
  if (!(await Dexie.exists(DB_NAME))) return null;
  const installed = new Dexie(DB_NAME);
  await installed.open();
  try {
    return schemaVersionOf(installed.verno);
  } finally {
    installed.close();
  }
}

/** The data as it is on this device, read without upgrading it. */
export async function readInstalled(): Promise<{ version: number; tables: TableRows }> {
  const installed = new Dexie(DB_NAME);
  await installed.open();
  try {
    const tables: TableRows = {};
    for (const table of installed.tables) tables[table.name] = await table.toArray();
    return { version: schemaVersionOf(installed.verno), tables };
  } finally {
    installed.close();
  }
}

/** Saved settings, for the screens that show before the data may be opened. */
export async function readInstalledSettings(): Promise<Partial<Settings> | undefined> {
  const installed = new Dexie(DB_NAME);
  try {
    await installed.open();
    return await installed.table('settings').get('main');
  } catch {
    return undefined;
  } finally {
    installed.close();
  }
}

export type Preflight = 'ok' | 'update-needed' | 'copy-failed';

export async function preflight(): Promise<Preflight> {
  let version: number | null;
  try {
    version = await installedVersion();
  } catch (e) {
    // Storage that can't be read here can't be upgraded either, so this isn't a reason to stop.
    console.warn('preflight failed', e);
    return 'ok';
  }
  if (version === null || version === SCHEMA_VERSION) return 'ok';
  if (version > SCHEMA_VERSION) return 'update-needed';
  try {
    const { tables } = await readInstalled();
    await saveCopy({ version, createdAt: Date.now(), tables });
    return 'ok';
  } catch (e) {
    console.warn('safety copy failed', e);
    return 'copy-failed';
  }
}

async function saveCopy(copy: SafetyCopy): Promise<void> {
  const safety = safetyDb();
  try {
    await safety.table('copies').add(copy);
    const old = await safety.table('copies').toCollection().reverse().offset(KEEP_COPIES).primaryKeys();
    await safety.table('copies').bulkDelete(old);
  } finally {
    safety.close();
  }
}

/** Newest first. */
export async function listCopies(): Promise<SafetyCopy[]> {
  if (!(await Dexie.exists(SAFETY_DB_NAME))) return [];
  const safety = safetyDb();
  try {
    return await safety.table<SafetyCopy>('copies').toCollection().reverse().toArray();
  } finally {
    safety.close();
  }
}

/** Every user table as it stands now. */
export async function readAllTables(): Promise<TableRows> {
  const tables: TableRows = {};
  for (const name of USER_TABLES) tables[name] = await db.table(name).toArray();
  return tables;
}

/** Before something replaces the data. An empty database has nothing worth keeping. */
export async function saveCurrentCopy(): Promise<void> {
  const tables = await readAllTables();
  if (!tables.workouts.length && !tables.customExercises.length) return;
  await saveCopy({ version: SCHEMA_VERSION, createdAt: Date.now(), tables });
}

/** A real day in the calendar, written as YYYY-MM-DD. */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isKey = (value: unknown) => (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value));
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown) => typeof value === 'string';
const isFlag = (value: unknown) => typeof value === 'boolean';

const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'smith', 'bodyweight', 'other'];
const LOADS: Load[] = ['weight', 'body', 'time'];

/** The rows of a table that have their keys. A row without one can't be stored or found. */
const rows = <T>(tables: TableRows, name: string, ...keys: string[]): T[] => {
  const list = tables[name];
  return (Array.isArray(list) ? list : []).filter((row) => isRow(row) && keys.every((key) => isKey(row[key]))) as T[];
};

/** Optional fields go when they hold something the app can't read; the rest of the row stays. */
function dropBad<T extends object>(row: T, isGood: (value: unknown) => boolean, ...fields: (keyof T & string)[]): T {
  const clean = { ...row };
  for (const field of fields) if (field in clean && !isGood(clean[field])) delete clean[field];
  return clean;
}

function normalizeWorkout(w: Workout): Workout {
  const row = dropBad(dropBad(w, isText, 'note', 'rawText', 'sourceKey'), isCount, 'startedAt', 'finishedAt');
  return {
    ...row,
    status: w.status === 'planned' || w.status === 'active' ? w.status : 'done',
    source: w.source === 'import' ? 'import' : 'app',
    updatedAt: isCount(w.updatedAt) ? w.updatedAt : 0,
  };
}

function normalizeSet(s: WorkoutSet): WorkoutSet {
  const row = dropBad(dropBad(dropBad(s, isCount, 'seconds', 'level'), isFlag, 'failure'), isText, 'note');
  return {
    ...row,
    entry: isCount(s.entry) ? s.entry : 0,
    order: isCount(s.order) ? s.order : 0,
    kind: s.kind === 'warmup' ? 'warmup' : 'work',
    weightKg: isCount(s.weightKg) ? s.weightKg : 0,
    reps: isCount(s.reps) ? s.reps : 0,
    done: isFlag(s.done) ? s.done : true,
  };
}

function normalizeCustom(c: CustomExercise): CustomExercise {
  const saved: Record<string, unknown> = isRow(c.names) ? c.names : {};
  const name = (lang: string) => (typeof saved[lang] === 'string' ? (saved[lang] as string) : '');
  const names = { ...saved, en: name('en'), de: name('de'), ru: name('ru') };
  // Sets can point at this exercise, so it stays. Its id is all that's left to call it.
  if (!names.en && !names.de && !names.ru) names.en = String(c.id);
  const row = dropBad(c, Array.isArray, 'aliases');
  return {
    ...row,
    names,
    muscle: MUSCLES.includes(c.muscle) ? c.muscle : 'fullBody',
    equipment: EQUIPMENT.includes(c.equipment) ? c.equipment : 'other',
    load: LOADS.includes(c.load) ? c.load : 'weight',
    compound: c.compound === true,
    createdAt: isCount(c.createdAt) ? c.createdAt : 0,
    ...(row.aliases ? { aliases: row.aliases.filter(isText) } : {}),
  };
}

function normalizeNote(n: ExerciseNote): ExerciseNote {
  const row = dropBad(dropBad(n, isText, 'text'), isRow, 'labels');
  return { ...row, tags: Array.isArray(n.tags) ? n.tags.filter(isText) : [] };
}

/**
 * Weigh-ins, one a day. Data from before the log only has the weight in settings, which held when
 * the data was saved: `day`, as the upgrade does for data on the device.
 */
function normalizeBodyWeights(tables: TableRows, settings: Settings[], day: string): BodyWeight[] {
  if (!Array.isArray(tables.bodyWeights)) {
    const kg = settings[0]?.bodyWeightKg ?? 0;
    return kg > 0 ? [{ date: day, kg }] : [];
  }
  const weights = rows<BodyWeight>(tables, 'bodyWeights', 'date').filter((w) => isDay(w.date) && isCount(w.kg) && w.kg > 0);
  return [...new Map(weights.map((w) => [w.date, w])).values()];
}

/**
 * Rows from any older version as today's code stores them, whatever a file says. Screens rely on
 * these shapes, so a bad value takes its default and an optional field that can't be read goes.
 * A row is only left out when nothing can be done with it: no key, or no day it belongs to. Sets
 * and workouts lend each other a missing date, because each keeps a copy. Fields this code doesn't
 * know, such as `title`, stay.
 *
 * Add a step here whenever a schema change adds a field or changes a format, so old backups and
 * safety copies keep restoring. `day` is when the data was saved, where that's known.
 */
export function normalizeTables(tables: TableRows, day = toISODate()): TableRows {
  const keyedSets = rows<WorkoutSet>(tables, 'sets', 'id', 'workoutId', 'exerciseId');
  const setDays = new Map(keyedSets.filter((s) => isDay(s.date)).map((s) => [s.workoutId, s.date]));
  const workouts = rows<Workout>(tables, 'workouts', 'id').flatMap((w) => {
    const date = isDay(w.date) ? w.date : setDays.get(w.id);
    return date ? [normalizeWorkout({ ...w, date })] : [];
  });
  const workoutDays = new Map(workouts.map((w) => [w.id, w.date]));
  const sets = keyedSets.flatMap((s) => {
    const date = isDay(s.date) ? s.date : workoutDays.get(s.workoutId);
    return date ? [normalizeSet({ ...s, date })] : [];
  });
  const exerciseSetting = (s: ExerciseSettings) => dropBad(dropBad(dropBad(s, isCount, 'stepKg', 'repLow', 'repHigh'), isText, 'machineSetting', 'goal'), isFlag, 'avoid');
  const settings = rows<Settings>(tables, 'settings', 'id').map(normalizeSettings);

  return {
    workouts,
    sets,
    customExercises: rows<CustomExercise>(tables, 'customExercises', 'id').map(normalizeCustom),
    aliases: rows<Alias>(tables, 'aliases', 'name', 'exerciseId'),
    exerciseSettings: rows<ExerciseSettings>(tables, 'exerciseSettings', 'exerciseId').map(exerciseSetting),
    baselines: rows<Baseline>(tables, 'baselines', 'id', 'exerciseId').filter((b) => isDay(b.date)),
    stallRecords: rows<StallRecord>(tables, 'stallRecords', 'id', 'exerciseId', 'action').filter((r) => isDay(r.date)),
    settings,
    // Older files can have none.
    exerciseNotes: rows<ExerciseNote>(tables, 'exerciseNotes', 'id').map(normalizeNote),
    bodyWeights: normalizeBodyWeights(tables, settings, day),
  };
}

/** How many rows of `source` normalizeTables() left out. A table it filled in has nothing left out. */
export function droppedRows(source: TableRows, tables: TableRows): number {
  return USER_TABLES.reduce((sum, name) => sum + Math.max(0, (Array.isArray(source[name]) ? source[name].length : 0) - tables[name].length), 0);
}

/** Swap everything for `tables` in one transaction: a failure leaves the data as it was. */
export async function replaceAllTables(tables: TableRows): Promise<void> {
  await db.transaction('rw', USER_TABLES.map((name) => db.table(name)), async () => {
    for (const name of USER_TABLES) {
      // Data without settings keeps the settings already on this device.
      if (name === 'settings' && !tables.settings.length) continue;
      await db.table(name).clear();
      await db.table(name).bulkPut(tables[name]);
    }
  });
}

/**
 * Put a copy back. The data it replaces becomes a copy of its own, so this can be undone.
 * Returns the number of rows that were left out as unusable.
 */
export async function restoreCopy(id: number): Promise<number> {
  const copy = (await listCopies()).find((c) => c.id === id);
  if (!copy) throw new Error(`No safety copy ${id}`);
  const tables = normalizeTables(copy.tables, toISODate(new Date(copy.createdAt)));
  await saveCurrentCopy();
  await replaceAllTables(tables);
  return droppedRows(copy.tables, tables);
}
