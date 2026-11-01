import { allNames, CATALOG, catalogExercise, normalizeName } from '../catalog/exercises';
import { createCustomExercise, nameFields } from '../catalog/custom';
import { t } from '../i18n.svelte';
import type { Baseline, CustomExercise, Equipment, Exercise, ExerciseNote, ExerciseSettings, Load, SetKind, Workout, WorkoutSet } from '../types';
import { isDay, isRow, type TableRows } from './safety';
import { newId } from './schema';

/**
 * The history file: workouts → exercises → sets, readable by people and easy to write by hand or
 * with a script. docs/import-format.md describes it. A backup is a different file: it mirrors the
 * database, whereas this one is meant for bringing workouts in.
 */
export const HISTORY_VERSION = 1;

/** A file that can't be used. The message is translated and tells the user what's wrong. */
export class FileError extends Error {}

export interface HistorySet {
  kind?: SetKind;
  weightKg?: number;
  reps?: number;
  seconds?: number;
  /** Taken to the point where another rep wasn't possible. */
  failure?: boolean;
  /** The bar or platform height, as numbered in the gym. */
  level?: number;
}

export interface HistoryComment {
  tags?: string[] | string;
  text?: string;
}

export interface HistoryExercise {
  /** An id from the catalogue, the device or `customExercises`. Without one, `name` finds the exercise or adds it. */
  exerciseId?: string;
  name?: string;
  machineSetting?: string;
  /** A comment can be plain text, and its `tags` a single tag. */
  comments?: (HistoryComment | string)[];
  sets: HistorySet[];
}

export interface HistoryWorkout {
  date: string;
  note?: string;
  /** The workout as it was first written down. */
  text?: string;
  exercises: HistoryExercise[];
}

/** What's set up for an exercise, such as the seat position; `name` is only there to read. */
export interface HistoryExerciseSetting extends Omit<ExerciseSettings, 'exerciseId'> {
  /** Without one, `name` finds the exercise. */
  exerciseId?: string;
  name?: string;
}

/** A move to another gym: machines there aren't comparable with the old ones. */
export interface HistoryGymChange {
  date: string;
  note?: string;
}

export interface HistoryFile {
  app: 'training';
  format: 'history';
  version: number;
  customExercises?: CustomExercise[];
  exerciseSettings?: HistoryExerciseSetting[];
  gymChanges?: HistoryGymChange[];
  workouts: HistoryWorkout[];
}

/** Shown on the Import screen; a test imports it, so it always works. */
export const HISTORY_EXAMPLE = {
  app: 'training',
  format: 'history',
  version: HISTORY_VERSION,
  exerciseSettings: [{ name: 'Machine chest press', exerciseId: 'machine-chest-press', machineSetting: 'Seat 8' }],
  gymChanges: [{ date: '2025-09-01', note: 'New gym' }],
  workouts: [
    {
      date: '2026-05-14',
      exercises: [
        {
          name: 'Leg press',
          sets: [
            { kind: 'warmup', weightKg: 75, reps: 13 },
            { kind: 'work', weightKg: 125, reps: 9 },
            { kind: 'work', weightKg: 125, reps: 6.5, failure: true },
          ],
        },
        {
          name: 'Plank',
          comments: [{ tags: ['tired'], text: 'Short on energy today' }],
          sets: [{ kind: 'work', seconds: 72 }],
        },
      ],
    },
  ],
};

let names: Map<string, string> | undefined;

/** The catalogue exercise with this name or alias, in any language. */
function catalogIdByName(name: string): string | undefined {
  names ??= new Map(CATALOG.flatMap((e) => allNames(e).map((n) => [normalizeName(n), e.id] as const)));
  return names.get(normalizeName(name));
}

export function isHistoryFile(file: unknown): file is HistoryFile {
  const f = file as Partial<HistoryFile> | null;
  return f?.app === 'training' && f.format === 'history';
}

const given = (value: unknown) => value !== undefined && value !== null;
const isName = (value: unknown): value is string => typeof value === 'string' && normalizeName(value) !== '';
const isOptionalText = (value: unknown) => !given(value) || typeof value === 'string';
const isAmount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isLevel = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** File text goes into error messages, so a long value doesn't fill the screen. */
const short = (value: unknown) => String(value).slice(0, 40);

function checkDay(date: unknown): void {
  if (!isDay(date)) throw new FileError(t('import.bad.date', { value: short(date) }));
}

const badField = (where: string, field: string) => new FileError(t('import.bad.field', { where, field }));

function checkSet(set: unknown, where: string): void {
  if (!isRow(set)) throw badField(where, 'sets');
  for (const field of ['weightKg', 'reps', 'seconds']) {
    if (given(set[field]) && !isAmount(set[field])) throw new FileError(t('import.bad.number', { where, field }));
  }
  if (given(set.level) && !isLevel(set.level)) throw new FileError(t('import.bad.level', { where }));
}

function checkComment(comment: unknown, where: string): void {
  if (typeof comment === 'string') return;
  if (!isRow(comment) || !isOptionalText(comment.text)) throw badField(where, 'comments');
  const { tags } = comment;
  const readable = !given(tags) || typeof tags === 'string' || (Array.isArray(tags) && tags.every((tag) => typeof tag === 'string'));
  if (!readable) throw badField(where, 'tags');
}

function checkExercise(exercise: unknown, date: string): void {
  const where = t('import.where.workout', { date });
  if (!isRow(exercise)) throw badField(where, 'exercises');
  const { exerciseId, name, sets, comments, machineSetting } = exercise;
  const label = short(name ?? exerciseId ?? '');
  const here = t('import.where.exercise', { date, exercise: label });
  if (given(name) && !isName(name)) throw badField(here, 'name');
  if (given(exerciseId) && !isName(exerciseId)) throw badField(here, 'exerciseId');
  if (!given(name) && !given(exerciseId)) throw badField(where, 'name');
  if (!Array.isArray(sets)) throw badField(here, 'sets');
  if (!isOptionalText(machineSetting)) throw badField(here, 'machineSetting');
  sets.forEach((set, i) => checkSet(set, t('import.where.set', { date, exercise: label, n: i + 1 })));
  if (!given(comments)) return;
  if (!Array.isArray(comments)) throw badField(here, 'comments');
  for (const comment of comments) checkComment(comment, here);
}

function checkCustom(custom: unknown): void {
  const id = isRow(custom) ? custom.id : undefined;
  if (!isRow(custom) || !isName(id)) throw badField('customExercises', 'id');
  const names = isRow(custom.names) ? Object.values(custom.names) : [];
  if (!names.some(isName) || !names.every((name) => typeof name === 'string')) {
    throw badField(t('import.where.custom', { name: short(id) }), 'names');
  }
}

function checkSetting(setting: unknown): void {
  if (!isRow(setting)) throw badField('exerciseSettings', 'exerciseId');
  const { exerciseId, name, machineSetting, goal } = setting;
  const where = t('import.where.setting', { name: short(name ?? exerciseId ?? '') });
  if (given(name) && !isName(name)) throw badField(where, 'name');
  if (given(exerciseId) && !isName(exerciseId)) throw badField(where, 'exerciseId');
  if (!given(name) && !given(exerciseId)) throw badField(where, 'name');
  if (!isOptionalText(machineSetting)) throw badField(where, 'machineSetting');
  for (const field of ['stepKg', 'repLow', 'repHigh']) {
    if (given(setting[field]) && !isAmount(setting[field])) throw new FileError(t('import.bad.number', { where, field }));
  }
  if (given(goal) && goal !== 'progress' && goal !== 'maintain') throw badField(where, 'goal');
}

/** Everything in the file is checked before anything is read from it, so nothing half imports. */
function checkFile(file: HistoryFile): void {
  if (file.version > HISTORY_VERSION) throw new FileError(t('import.newer'));
  const { workouts, gymChanges, customExercises, exerciseSettings } = file;
  if (!Array.isArray(workouts)) throw new FileError(t('import.notHistory'));
  for (const workout of workouts as unknown[]) {
    if (!isRow(workout)) throw new FileError(t('import.notHistory'));
    const { date, exercises, note, text } = workout;
    checkDay(date);
    const where = t('import.where.workout', { date: date as string });
    if (!Array.isArray(exercises)) throw badField(where, 'exercises');
    if (!isOptionalText(note)) throw badField(where, 'note');
    if (!isOptionalText(text)) throw badField(where, 'text');
    for (const exercise of exercises) checkExercise(exercise, date as string);
  }
  if (given(customExercises)) {
    if (!Array.isArray(customExercises)) throw badField('customExercises', 'id');
    (customExercises as unknown[]).forEach(checkCustom);
  }
  if (given(exerciseSettings)) {
    if (!Array.isArray(exerciseSettings)) throw badField('exerciseSettings', 'exerciseId');
    (exerciseSettings as unknown[]).forEach(checkSetting);
  }
  if (given(gymChanges)) {
    if (!Array.isArray(gymChanges)) throw badField('gymChanges', 'date');
    for (const change of gymChanges as unknown[]) {
      if (!isRow(change)) throw badField('gymChanges', 'date');
      checkDay(change.date);
      if (!isOptionalText(change.note)) throw badField(t('import.where.gym', { date: change.date as string }), 'note');
    }
  }
}

function loadOf(sets: HistorySet[]): Load {
  if (sets.some((s) => s.seconds)) return 'time';
  return sets.some((s) => (s.weightKg ?? 0) > 0) ? 'weight' : 'body';
}

/** A comment as stored; one with nothing in it is left out. */
function commentOf(comment: HistoryComment | string): { tags: string[]; text?: string } | null {
  const { tags, text } = typeof comment === 'string' ? { tags: undefined, text: comment } : comment;
  const list = typeof tags === 'string' ? [tags] : (tags ?? []);
  const read = list.filter(Boolean);
  const words = text?.trim() ? text : undefined;
  if (!read.length && !words) return null;
  return words ? { tags: read, text: words } : { tags: read };
}

/** Custom exercises by every name they go by, in any language. */
function byName(exercises: Exercise[]): Map<string, string> {
  return new Map(exercises.flatMap((e) => allNames(e).map((n) => [normalizeName(n), e.id] as const)));
}

/** Equipment that differs from gym to gym; a kilo on a barbell or dumbbell is the same anywhere. */
const GYM_EQUIPMENT: Equipment[] = ['machine', 'cable', 'smith'];

/**
 * A comparison restart per gym change, for each exercise on that gym's own equipment trained before
 * it, in the file or on this device (`sets` holds both).
 */
function gymBaselines(changes: HistoryGymChange[], sets: Pick<WorkoutSet, 'exerciseId' | 'date'>[], exerciseOf: (id: string) => Exercise | undefined): Baseline[] {
  const first = new Map<string, string>();
  for (const { exerciseId, date } of sets) {
    const earliest = first.get(exerciseId);
    if (!earliest || date < earliest) first.set(exerciseId, date);
  }
  return changes.flatMap(({ date, note }) =>
    [...first]
      .filter(([id, earliest]) => earliest < date && GYM_EQUIPMENT.includes(exerciseOf(id)?.equipment as Equipment))
      .map(([exerciseId]): Baseline => ({ id: `gym-${date}-${exerciseId}`, exerciseId, date, ...(note ? { note } : {}) })),
  );
}

/**
 * The file's workouts as database rows. An exercise is found by id, then by name: in the catalogue,
 * among `saved` (the custom exercises already on this device), among the file's own, and only then
 * is it added. So its sets join the ones logged in the app, whichever language the file uses.
 * `trained` is the sets already on this device, so a gym change covers exercises logged in the app.
 * Throws a FileError, with a message for the user, when the file can't be used.
 */
export function historyTables(
  file: HistoryFile,
  saved: CustomExercise[] = [],
  now = Date.now(),
  trained: Pick<WorkoutSet, 'exerciseId' | 'date'>[] = [],
): TableRows {
  checkFile(file);

  const customs = new Map((file.customExercises ?? []).map((c) => [c.id, c]));
  const savedIds = new Set(saved.map((c) => c.id));
  const savedNames = byName(saved);
  const fileNames = byName([...customs.values()]);
  /** Exercises that only have a name: one new exercise per name. */
  const named = new Map<string, CustomExercise>();

  /** All the sets of a name in the file: one workout alone can't tell what the exercise measures. */
  const setsOfName = new Map<string, HistorySet[]>();
  for (const workout of file.workouts) {
    for (const exercise of workout.exercises) {
      const key = normalizeName(exercise.name || exercise.exerciseId!);
      const list = setsOfName.get(key) ?? [];
      setsOfName.set(key, list);
      for (const set of exercise.sets) list.push(set);
    }
  }

  /** The id an exercise goes by on this device, when the file's id is one the app can use. */
  const knownId = (id: string): string | undefined => {
    if (catalogExercise(id) || savedIds.has(id)) return id;
    const custom = customs.get(id);
    if (!custom) return undefined;
    return allNames(custom).map((n) => savedNames.get(normalizeName(n))).find(Boolean) ?? id;
  };

  /** An exercise the app or the file already has, without adding one. */
  const findId = ({ exerciseId, name }: Pick<HistoryExercise, 'exerciseId' | 'name'>): string | undefined => {
    const id = exerciseId && knownId(exerciseId);
    if (id) return id;
    const label = name || exerciseId!;
    const key = normalizeName(label);
    const inFile = fileNames.get(key);
    return catalogIdByName(label) ?? savedNames.get(key) ?? (inFile && knownId(inFile)) ?? named.get(key)?.id;
  };

  const exerciseIdOf = (exercise: HistoryExercise): string => {
    const known = findId(exercise);
    if (known) return known;
    const name = exercise.name || exercise.exerciseId!;
    const key = normalizeName(name);
    const custom = createCustomExercise({ names: nameFields(name), muscle: 'fullBody', equipment: 'other', load: loadOf(setsOfName.get(key) ?? []) }, now);
    named.set(key, custom);
    return custom.id;
  };

  const workouts: Workout[] = [];
  const sets: WorkoutSet[] = [];
  const exerciseNotes: ExerciseNote[] = [];
  const machines = new Map<string, ExerciseSettings>();

  for (const source of file.workouts) {
    const workoutId = newId();
    const { date } = source;
    const workout: Workout = { id: workoutId, date, status: 'done', source: 'import', updatedAt: now, sourceKey: `history:${date}` };
    if (source.note) workout.note = source.note;
    if (source.text) workout.rawText = source.text;
    workouts.push(workout);

    source.exercises.forEach((exercise, entry) => {
      const exerciseId = exerciseIdOf(exercise);
      exercise.sets.forEach((set, order) => {
        const row: WorkoutSet = {
          id: newId(),
          workoutId,
          exerciseId,
          date,
          entry,
          order,
          kind: set.kind === 'warmup' ? 'warmup' : 'work',
          weightKg: set.weightKg ?? 0,
          reps: set.reps ?? 0,
          done: true,
        };
        if (typeof set.seconds === 'number') row.seconds = set.seconds;
        if (set.failure === true) row.failure = true;
        if (typeof set.level === 'number') row.level = set.level;
        sets.push(row);
      });
      for (const comment of exercise.comments ?? []) {
        const read = commentOf(comment);
        if (read) exerciseNotes.push({ id: newId(), workoutId, exerciseId, date, ...read });
      }
      // Workouts run oldest to newest in time, so the latest setting wins.
      if (exercise.machineSetting) machines.set(exerciseId, { exerciseId, machineSetting: exercise.machineSetting });
    });
  }

  // The file's list says what's current, so it wins over a setting on a single old workout.
  for (const { name, exerciseId: id, ...setting } of file.exerciseSettings ?? []) {
    const exerciseId = findId({ exerciseId: id, name });
    if (exerciseId) machines.set(exerciseId, { ...setting, exerciseId });
  }

  const customById = new Map([...saved, ...customs.values(), ...named.values()].map((c) => [c.id, c]));

  return {
    workouts,
    sets,
    exerciseNotes,
    customExercises: [...customs.values(), ...named.values()],
    exerciseSettings: [...machines.values()],
    baselines: gymBaselines(file.gymChanges ?? [], [...sets, ...trained], (id) => catalogExercise(id) ?? customById.get(id)),
  };
}
