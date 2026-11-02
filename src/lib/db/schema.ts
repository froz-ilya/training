import Dexie, { type EntityTable } from 'dexie';
import { toISODate } from '../dates';
import type {
  Alias,
  Baseline,
  BodyWeight,
  CustomExercise,
  ExerciseNote,
  ExerciseSettings,
  Settings,
  StallRecord,
  Workout,
  WorkoutSet,
} from '../types';

export const DB_NAME = 'training';

/**
 * The newest schema version this code knows. Raise it together with a new this.version() block
 * below. Rules: CLAUDE.md, "User data must stay compatible". Existing blocks are never edited.
 */
export const SCHEMA_VERSION = 2;

/** Tables that hold user data: backups and safety copies carry all of them. */
export const USER_TABLES = [
  'workouts',
  'sets',
  'customExercises',
  'aliases',
  'exerciseSettings',
  'baselines',
  'stallRecords',
  'settings',
  'exerciseNotes',
  'bodyWeights',
] as const;

/**
 * Dexie reports the native version / 10. When an installed database differs from the declared
 * schema it opens one native version higher (1.1), which is still schema version 1.
 */
export function schemaVersionOf(verno: number): number {
  return Math.floor(verno);
}

export class TrainingDB extends Dexie {
  workouts!: EntityTable<Workout, 'id'>;
  sets!: EntityTable<WorkoutSet, 'id'>;
  customExercises!: EntityTable<CustomExercise, 'id'>;
  aliases!: EntityTable<Alias, 'name'>;
  exerciseSettings!: EntityTable<ExerciseSettings, 'exerciseId'>;
  baselines!: EntityTable<Baseline, 'id'>;
  stallRecords!: EntityTable<StallRecord, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  exerciseNotes!: EntityTable<ExerciseNote, 'id'>;
  bodyWeights!: EntityTable<BodyWeight, 'date'>;

  /** The stored data turned out newer than this code, so this connection stays closed for good. */
  outdated = false;
  private outdatedListeners: (() => void)[] = [];

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      workouts: 'id, date, status, sourceKey',
      sets: 'id, workoutId, exerciseId, [exerciseId+date]',
      customExercises: 'id',
      aliases: 'name',
      exerciseSettings: 'exerciseId',
      baselines: 'id, exerciseId',
      stallRecords: 'id, exerciseId',
      settings: 'id',
      exerciseNotes: 'id, workoutId, exerciseId, [exerciseId+date]',
    });
    // The weight in settings starts the log. It's all that's known, and it holds as of the upgrade.
    this.version(2)
      .stores({ bodyWeights: 'date' })
      .upgrade(async (tx) => {
        const kg = (await tx.table('settings').get('main'))?.bodyWeightKg;
        if (typeof kg === 'number' && kg > 0) await tx.table('bodyWeights').put({ date: toISODate(), kg });
      });
    // A newer tab is upgrading the data. Left alone, Dexie closes this connection but the next query
    // reopens it at the new version, and old code writes into data it doesn't understand. So this
    // tab closes for good: queries now reject, and the upgrade in the other tab can go ahead.
    this.on('versionchange', (event) => {
      if (schemaVersionOf((event.newVersion ?? 0) / 10) <= SCHEMA_VERSION) return;
      this.stopForNewerData();
      return false; // Keeps Dexie's own handler, which would allow reopening, from running.
    });
    // The same for a connection that opens after the upgrade: Dexie falls back to the installed
    // version rather than failing, so a later reopen could get here without a versionchange.
    this.on(
      'ready',
      () => {
        if (schemaVersionOf(this.backendDB().version / 10) <= SCHEMA_VERSION) return;
        this.stopForNewerData();
        throw new Dexie.DatabaseClosedError('The stored data is newer than this version of the app');
      },
      true,
    );
  }

  private stopForNewerData(): void {
    if (this.outdated) return;
    this.outdated = true;
    this.close();
    for (const listener of this.outdatedListeners) listener();
  }

  /** `listener` runs once the stored data proves newer than this code: time for the update screen. */
  whenOutdated(listener: () => void): void {
    if (this.outdated) listener();
    else this.outdatedListeners.push(listener);
  }
}

export const db = new TrainingDB();

/** Ask the browser not to evict this app's data when the device runs low on storage. */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not available here: the app works the same, only without the extra protection.
  }
}

export function newId(): string {
  return crypto.randomUUID();
}
