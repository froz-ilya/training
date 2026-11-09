import Dexie from 'dexie';
import { db, newId } from './schema';
import { CATALOG, catalogExercise } from '../catalog/exercises';
import { mainGroups, type MuscleGroup } from '../catalog/groups';
import { bodyKg, effectiveRows } from '../coach/strength';
import { toISODate } from '../dates';
import { settings } from '../settings.svelte';
import { groupEntries } from '../workout/entries';
import { groupWork } from '../workout/title';
import type { CustomExercise, Exercise, ExerciseNote, Load, Workout, WorkoutSet, WorkoutStatus } from '../types';

/**
 * Every change is written to IndexedDB as it happens, so closing the app mid-workout loses nothing.
 *
 * An exercise belongs to a workout through its sets: one `entry` number per exercise card. Once a
 * workout is done all its sets are done, so code reading history can rely on that.
 */

/**
 * Rows of finished workouts as the app reads them: see effectiveSets(). What's stored never changes,
 * so backups and exports keep the raw rows. Inside a transaction, that needs db.customExercises.
 */
export async function effectiveHistory(rows: WorkoutSet[]): Promise<WorkoutSet[]> {
  const loads = new Map<string, Load | undefined>();
  for (const id of new Set(rows.map((s) => s.exerciseId))) {
    loads.set(id, (catalogExercise(id) ?? (await db.customExercises.get(id)))?.load);
  }
  return effectiveRows(rows, (id) => loads.get(id), bodyKg(settings.bodyWeightKg));
}

/** What a delete removed, so "Undo" can put it back. */
export interface Snapshot {
  workouts: Workout[];
  sets: WorkoutSet[];
  notes?: ExerciseNote[];
  /** Sets the change added, which "Undo" takes out again. */
  added?: string[];
}

export function deleteWorkout(id: string): Promise<Snapshot> {
  return db.transaction('rw', db.workouts, db.sets, db.exerciseNotes, async () => {
    const workouts = await db.workouts.where('id').equals(id).toArray();
    const sets = await db.sets.where('workoutId').equals(id).toArray();
    const notes = await db.exerciseNotes.where('workoutId').equals(id).toArray();
    await db.workouts.bulkDelete(workouts.map((w) => w.id));
    await db.sets.bulkDelete(sets.map((s) => s.id));
    await db.exerciseNotes.bulkDelete(notes.map((n) => n.id));
    return { workouts, sets, notes };
  });
}

export function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  return db.transaction('rw', db.workouts, db.sets, db.exerciseNotes, async () => {
    await db.workouts.bulkPut(snapshot.workouts);
    await db.sets.bulkPut(snapshot.sets);
    await db.exerciseNotes.bulkPut(snapshot.notes ?? []);
    await db.sets.bulkDelete(snapshot.added ?? []);
  });
}

// ---------- Workouts ----------

export interface NewWorkout {
  date?: string;
  status?: WorkoutStatus;
}

export async function createWorkout(init: NewWorkout = {}): Promise<string> {
  const now = Date.now();
  const status = init.status ?? 'active';
  const workout: Workout = {
    id: newId(),
    date: init.date ?? toISODate(),
    status,
    source: 'app',
    updatedAt: now,
  };
  if (status === 'active') workout.startedAt = now;
  await db.workouts.add(workout);
  return workout.id;
}

export function activeWorkout(): Promise<Workout | undefined> {
  return db.workouts.where('status').equals('active').first();
}

/** Starts a planned workout: it takes place today, whenever it was planned for. */
export function startWorkout(id: string): Promise<void> {
  return updateWorkout(id, { status: 'active', startedAt: Date.now(), date: toISODate() });
}

/** Sets a workout's fields; a new date also moves its sets, which keep a copy of it. */
export function updateWorkout(
  id: string,
  changes: Partial<Pick<Workout, 'date' | 'note' | 'status' | 'startedAt' | 'finishedAt'>>,
): Promise<void> {
  return db.transaction('rw', db.workouts, db.sets, db.exerciseNotes, async () => {
    await db.workouts.update(id, { ...changes, updatedAt: Date.now() });
    if (changes.date) {
      await db.sets.where('workoutId').equals(id).modify({ date: changes.date });
      await db.exerciseNotes.where('workoutId').equals(id).modify({ date: changes.date });
    }
  });
}

/**
 * Ends a workout. Sets not checked off are marked done or dropped, as `unchecked` says.
 * Returns false when nothing was left to keep, in which case the workout is gone.
 */
export function finishWorkout(id: string, unchecked: 'done' | 'discard' = 'done'): Promise<boolean> {
  return db.transaction('rw', db.workouts, db.sets, async () => {
    const sets = await db.sets.where('workoutId').equals(id).toArray();
    const open = sets.filter((s) => !s.done);
    if (unchecked === 'discard') await db.sets.bulkDelete(open.map((s) => s.id));
    else await db.sets.bulkPut(open.map((s) => ({ ...s, done: true })));
    if (unchecked === 'discard' && open.length === sets.length) {
      await db.workouts.delete(id);
      return false;
    }
    const now = Date.now();
    await db.workouts.update(id, { status: 'done', finishedAt: now, updatedAt: now });
    return true;
  });
}

/** A new active workout with the same exercises and numbers as a past one. */
export function repeatWorkout(id: string): Promise<string> {
  return db.transaction('rw', db.workouts, db.sets, db.customExercises, async () => {
    const source = await db.workouts.get(id);
    const copyId = await createWorkout();
    const date = toISODate();
    const rows = await db.sets.where('workoutId').equals(id).toArray();
    const sets = source?.status === 'done' ? await effectiveHistory(rows) : rows;
    // The copy keeps every set, but Focus's mark belongs to the plan it came from.
    await db.sets.bulkAdd(
      sets.map((s) => {
        const set: WorkoutSet = { ...s, id: newId(), workoutId: copyId, date, done: false };
        delete set.extra;
        return set;
      }),
    );
    return copyId;
  });
}

/** A workout written out in advance, such as the suggested next one. */
export interface WorkoutPlan {
  exercises: { exerciseId: string; sets: PlannedSet[] }[];
}

export type PlannedSet = Pick<WorkoutSet, 'kind' | 'weightKg' | 'reps' | 'seconds' | 'level' | 'failure' | 'extra'>;

function planRows(base: Pick<WorkoutSet, 'workoutId' | 'exerciseId' | 'date' | 'entry'>, sets: PlannedSet[]): WorkoutSet[] {
  return sets.map((set, order) => {
    const row: WorkoutSet = { ...base, id: newId(), order, kind: set.kind, weightKg: set.weightKg, reps: set.reps, done: false };
    if (set.seconds !== undefined) row.seconds = set.seconds;
    if (set.level !== undefined) row.level = set.level;
    if (set.failure) row.failure = true;
    if (set.extra) row.extra = true;
    return row;
  });
}

export function createFromPlan(plan: WorkoutPlan, status: 'active' | 'planned'): Promise<string> {
  return db.transaction('rw', db.workouts, db.sets, async () => {
    const id = await createWorkout({ status });
    const date = (await db.workouts.get(id))?.date ?? toISODate();
    await db.sets.bulkAdd(
      plan.exercises.flatMap((exercise, entry) =>
        planRows({ workoutId: id, exerciseId: exercise.exerciseId, date, entry }, exercise.sets),
      ),
    );
    return id;
  });
}

/** How much of a suggestion a plan from today has to hold to still be that suggestion, edited. */
const SAME_PLAN_SHARE = 0.5;

/**
 * The planned workout to edit `plan` in. One with the same exercises is opened as it is, and so is
 * one from today that starts the same way and holds most of them, since that's this plan with the
 * user's changes in it. So editing again never adds a second copy, and any other type or variant
 * gets its own plan.
 */
export function planForEditing(plan: WorkoutPlan): Promise<string> {
  return db.transaction('rw', db.workouts, db.sets, async () => {
    const wanted = plan.exercises.map((e) => e.exerciseId);
    const today = toISODate();
    const planned = [];
    for (const workout of await db.workouts.where('status').equals('planned').toArray()) {
      const sets = await db.sets.where('workoutId').equals(workout.id).toArray();
      planned.push({ id: workout.id, today: workout.date === today, ids: groupEntries(sets).map((e) => e.exerciseId) });
    }
    const same = (ids: string[]) => ids.join('|') === wanted.join('|');
    const edited = (ids: string[]) => ids[0] === wanted[0] && wanted.filter((id) => ids.includes(id)).length / wanted.length >= SAME_PLAN_SHARE;
    const fromToday = planned.filter((p) => p.today);
    const found = fromToday.find((p) => same(p.ids)) ?? fromToday.find((p) => edited(p.ids)) ?? planned.find((p) => same(p.ids));
    return found?.id ?? createFromPlan(plan, 'planned');
  });
}

/** Swaps an exercise's unfinished sets for a suggestion; sets already done stay. */
export function applyPlan(workoutId: string, entry: number, sets: PlannedSet[]): Promise<void> {
  return db.transaction('rw', db.workouts, db.sets, async () => {
    const all = await db.sets.where('workoutId').equals(workoutId).toArray();
    const current = all.filter((s) => s.entry === entry).sort((a, b) => a.order - b.order);
    const first = current[0];
    if (!first) return;
    const kept = current.filter((s) => s.done);
    // Sets already done count towards the plan: a finished warm-up isn't repeated.
    const left = { warmup: kept.filter((s) => s.kind === 'warmup').length, work: kept.filter((s) => s.kind === 'work').length };
    const remaining = sets.filter((set) => (left[set.kind]-- > 0 ? false : true));
    const rows = planRows({ workoutId, exerciseId: first.exerciseId, date: first.date, entry }, remaining);
    const start = Math.max(-1, ...kept.map((s) => s.order)) + 1;
    // Open sets keep their ids, so the rows on screen change in place and a set's comment stays with it.
    const open = { warmup: current.filter((s) => !s.done && s.kind === 'warmup'), work: current.filter((s) => !s.done && s.kind === 'work') };
    const placed = rows.map((row, i) => ({ ...row, id: open[row.kind].shift()?.id ?? row.id, order: start + i }));
    await db.sets.bulkDelete([...open.warmup, ...open.work].map((s) => s.id));
    await db.sets.bulkPut(placed);
    await touch(workoutId);
  });
}

async function touch(workoutId: string): Promise<void> {
  await db.workouts.update(workoutId, { updatedAt: Date.now() });
}

// ---------- Exercises in a workout ----------

export interface Performance {
  workoutId: string;
  date: string;
  sets: WorkoutSet[];
  /** Where the exercise came in that workout, from 1. */
  position: number;
}

/**
 * The latest finished workout with this exercise, on or before `before`, read as effectiveHistory()
 * reads it. Planned and active workouts don't count, and `excludeWorkoutId` leaves out the workout
 * being logged.
 */
export async function lastPerformance(
  exerciseId: string,
  { before = '9999-12-31', excludeWorkoutId }: { before?: string; excludeWorkoutId?: string } = {},
): Promise<Performance | null> {
  const rows = await db.sets
    .where('[exerciseId+date]')
    .between([exerciseId, Dexie.minKey], [exerciseId, before], true, true)
    .reverse()
    .toArray();
  const checked = new Map<string, boolean>();
  for (const row of rows) {
    if (row.workoutId === excludeWorkoutId) continue;
    let finished = checked.get(row.workoutId);
    if (finished === undefined) {
      finished = (await db.workouts.get(row.workoutId))?.status === 'done';
      checked.set(row.workoutId, finished);
    }
    if (!finished) continue;
    const sets = rows
      .filter((s) => s.workoutId === row.workoutId)
      .sort((a, b) => a.entry - b.entry || a.order - b.order);
    const all = await db.sets.where('workoutId').equals(row.workoutId).toArray();
    const order = [...new Set(all.map((s) => s.entry))].sort((x, y) => x - y);
    return { workoutId: row.workoutId, date: row.date, sets: await effectiveHistory(sets), position: order.indexOf(sets[0].entry) + 1 };
  }
  return null;
}

/** Adds an exercise as a new card, filled in with last time's sets when there are any, leaving out Focus's extras. */
export function addExercise(workoutId: string, exerciseId: string): Promise<number> {
  return db.transaction('rw', db.workouts, db.sets, db.customExercises, async () => {
    const workout = await db.workouts.get(workoutId);
    if (!workout) throw new Error('No such workout');
    const existing = await db.sets.where('workoutId').equals(workoutId).toArray();
    const entry = Math.max(-1, ...existing.map((s) => s.entry)) + 1;
    const sets = await startingSets({ workoutId, exerciseId, date: workout.date, entry, done: workout.status === 'done' });
    await db.sets.bulkAdd(sets);
    await touch(workoutId);
    return entry;
  });
}

/** A new exercise's sets: what was done last time, without Focus's extra sets, or one empty set. */
async function startingSets(base: Pick<WorkoutSet, 'workoutId' | 'exerciseId' | 'date' | 'entry' | 'done'>): Promise<WorkoutSet[]> {
  const last = await lastPerformance(base.exerciseId, { before: base.date, excludeWorkoutId: base.workoutId });
  const usual = last?.sets.filter((s) => !s.extra) ?? [];
  return usual.length
    ? usual.map((s, order) => {
        const set: WorkoutSet = { ...base, id: newId(), order, kind: s.kind, weightKg: s.weightKg, reps: s.reps };
        if (s.seconds !== undefined) set.seconds = s.seconds;
        if (s.level !== undefined) set.level = s.level;
        if (s.failure) set.failure = true;
        return set;
      })
    : [{ ...base, id: newId(), order: 0, kind: 'work', weightKg: 0, reps: 0 }];
}

/**
 * Puts `exerciseId` in the place of the exercise at `entry`, with the sets it would get if added.
 * Only for an exercise with nothing done yet, so no logged work is lost. Its comments go with it,
 * unless the workout has it a second time.
 */
export function replaceExercise(workoutId: string, entry: number, exerciseId: string): Promise<Snapshot> {
  return db.transaction('rw', [db.workouts, db.sets, db.exerciseNotes, db.customExercises], async () => {
    const workout = await db.workouts.get(workoutId);
    if (!workout || workout.status === 'done') throw new Error('Workout is finished');
    const all = await db.sets.where('workoutId').equals(workoutId).toArray();
    const sets = all.filter((s) => s.entry === entry);
    if (!sets.length || sets.some((s) => s.done)) throw new Error('Exercise has done sets');
    const others = new Set(all.filter((s) => s.entry !== entry).map((s) => s.exerciseId));
    const old = sets[0].exerciseId;
    const notes = await db.exerciseNotes.where('workoutId').equals(workoutId).toArray();
    const removed = notes.filter((n) => n.exerciseId === old && !others.has(n.exerciseId));
    const added = await startingSets({ workoutId, exerciseId, date: workout.date, entry, done: false });
    await db.sets.bulkDelete(sets.map((s) => s.id));
    await db.exerciseNotes.bulkDelete(removed.map((n) => n.id));
    await db.sets.bulkAdd(added);
    await touch(workoutId);
    return { workouts: [], sets, notes: removed, added: added.map((s) => s.id) };
  });
}

export function removeExercise(workoutId: string, entry: number): Promise<Snapshot> {
  return db.transaction('rw', db.workouts, db.sets, db.exerciseNotes, async () => {
    const all = await db.sets.where('workoutId').equals(workoutId).toArray();
    const sets = all.filter((s) => s.entry === entry);
    const others = new Set(all.filter((s) => s.entry !== entry).map((s) => s.exerciseId));
    const exerciseId = sets[0]?.exerciseId;
    const notes = await db.exerciseNotes.where('workoutId').equals(workoutId).toArray();
    // The same exercise can appear twice in a workout; its comments stay with the one that's left.
    const removed = notes.filter((n) => n.exerciseId === exerciseId && !others.has(n.exerciseId));
    await db.sets.bulkDelete(sets.map((s) => s.id));
    await db.exerciseNotes.bulkDelete(removed.map((n) => n.id));
    await touch(workoutId);
    return { workouts: [], sets, notes: removed };
  });
}

/** Moves an exercise one place up (-1) or down (1). */
export function moveExercise(workoutId: string, entry: number, direction: -1 | 1): Promise<void> {
  return db.transaction('rw', db.workouts, db.sets, async () => {
    const all = await db.sets.where('workoutId').equals(workoutId).toArray();
    const entries = [...new Set(all.map((s) => s.entry))].sort((a, b) => a - b);
    const other = entries[entries.indexOf(entry) + direction];
    if (other === undefined) return;
    await db.sets.bulkPut(
      all
        .filter((s) => s.entry === entry || s.entry === other)
        .map((s) => ({ ...s, entry: s.entry === entry ? other : entry })),
    );
    await touch(workoutId);
  });
}

// ---------- Sets ----------

/** Adds a set to an exercise, starting from the numbers of the set before it. */
export function addSet(workoutId: string, entry: number): Promise<string> {
  return db.transaction('rw', db.workouts, db.sets, async () => {
    const workout = await db.workouts.get(workoutId);
    const all = await db.sets.where('workoutId').equals(workoutId).toArray();
    const sets = all.filter((s) => s.entry === entry).sort((a, b) => a.order - b.order);
    const previous = sets.at(-1);
    if (!workout || !previous) throw new Error('No such exercise in this workout');
    const set: WorkoutSet = {
      id: newId(),
      workoutId,
      exerciseId: previous.exerciseId,
      date: workout.date,
      entry,
      order: previous.order + 1,
      kind: 'work',
      weightKg: previous.weightKg,
      reps: previous.reps,
      done: workout.status === 'done',
    };
    if (previous.seconds !== undefined) set.seconds = previous.seconds;
    if (previous.level !== undefined) set.level = previous.level;
    if (previous.failure) set.failure = true;
    await db.sets.add(set);
    await touch(workoutId);
    return set.id;
  });
}

export function updateSet(
  id: string,
  changes: Partial<Pick<WorkoutSet, 'weightKg' | 'reps' | 'seconds' | 'failure' | 'level' | 'kind' | 'done' | 'note'>>,
): Promise<void> {
  return db.transaction('rw', db.workouts, db.sets, async () => {
    const set = await db.sets.get(id);
    if (!set) return;
    await db.sets.update(id, changes);
    await touch(set.workoutId);
  });
}

export function removeSet(id: string): Promise<Snapshot> {
  return db.transaction('rw', db.workouts, db.sets, db.exerciseNotes, async () => {
    const set = await db.sets.get(id);
    if (!set) return { workouts: [], sets: [] };
    const notes = (await db.exerciseNotes.where('workoutId').equals(set.workoutId).toArray()).filter((n) => n.setId === id);
    await db.sets.delete(id);
    await db.exerciseNotes.bulkDelete(notes.map((n) => n.id));
    await touch(set.workoutId);
    return { workouts: [], sets: [set], notes };
  });
}

/** Whether a write failed because the device is out of room. Dexie can wrap the original error. */
export function isStorageFull(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, inner, failures } = error as { name?: string; inner?: unknown; failures?: unknown };
  return name === 'QuotaExceededError' || isStorageFull(inner) || (Array.isArray(failures) && failures.some(isStorageFull));
}

// ---------- Comments ----------

export type NoteDraft = Omit<ExerciseNote, 'id'> & { id?: string };

/** Saves a comment; one with no tags and no text is removed. Returns the id, or null when removed. */
export async function saveNote(draft: NoteDraft): Promise<string | null> {
  const text = draft.text?.trim() || undefined;
  if (!draft.tags.length && !text) {
    if (draft.id) await db.exerciseNotes.delete(draft.id);
    return null;
  }
  const id = draft.id ?? newId();
  await db.exerciseNotes.put({ ...draft, id, text });
  return id;
}

export function deleteNote(id: string): Promise<void> {
  return db.exerciseNotes.delete(id);
}

// ---------- Lists ----------

export interface WorkoutSummary {
  exercises: number;
  sets: number;
  /** What it trained, for workoutTitle(). */
  groups: MuscleGroup[];
}

/** What a page of workouts holds, without reading the whole history. */
export async function summarize(workoutIds: string[]): Promise<Map<string, WorkoutSummary>> {
  const [sets, custom, workouts] = await Promise.all([
    db.sets.where('workoutId').anyOf(workoutIds).toArray(),
    db.customExercises.toArray(),
    db.workouts.bulkGet(workoutIds),
  ]);
  const exercises = new Map<string, Exercise>([...CATALOG, ...custom].map((e) => [e.id, e]));
  const perWorkout = new Map<string, WorkoutSet[]>(workoutIds.map((id) => [id, []]));
  const finished = new Set(workouts.filter((w) => w?.status === 'done').map((w) => w?.id));
  const history = await effectiveHistory(sets.filter((s) => finished.has(s.workoutId)));
  for (const set of [...history, ...sets.filter((s) => !finished.has(s.workoutId))]) perWorkout.get(set.workoutId)!.push(set);
  const summaries = new Map<string, WorkoutSummary>();
  for (const [id, rows] of perWorkout) {
    summaries.set(id, {
      exercises: new Set(rows.map((s) => s.entry)).size,
      sets: rows.length,
      // In workout order, so groups with equal sets read the same every time.
      groups: mainGroups(groupWork([...rows].sort((a, b) => a.entry - b.entry), exercises)),
    });
  }
  return summaries;
}

/** Finished workouts, newest first. */
export function finishedWorkouts(limit: number): Promise<Workout[]> {
  return db.workouts
    .orderBy('date')
    .reverse()
    .filter((w) => w.status === 'done')
    .limit(limit)
    .toArray();
}

/** Exercises from the latest workouts, most recent first. */
export async function recentExerciseIds(limit = 12): Promise<string[]> {
  const workouts = await db.workouts.orderBy('date').reverse().limit(20).toArray();
  const sets = await db.sets.where('workoutId').anyOf(workouts.map((w) => w.id)).toArray();
  sets.sort((a, b) => b.date.localeCompare(a.date) || a.entry - b.entry);
  return [...new Set(sets.map((s) => s.exerciseId))].slice(0, limit);
}

// ---------- Exercise details ----------

/** Saves the machine setting of an exercise; other fields of its settings stay as they are. */
export function setMachineSetting(exerciseId: string, machineSetting: string): Promise<void> {
  return db.transaction('rw', db.exerciseSettings, async () => {
    const saved = await db.exerciseSettings.get(exerciseId);
    await db.exerciseSettings.put({ ...saved, exerciseId, machineSetting: machineSetting || undefined });
  });
}

/** An exercise named during a workout, when the catalogue doesn't have it. */
export async function quickCustomExercise(name: string): Promise<string> {
  const exercise: CustomExercise = {
    id: `custom-${newId()}`,
    names: { en: name, de: name, ru: name },
    muscle: 'fullBody',
    equipment: 'other',
    load: 'weight',
    compound: false,
    createdAt: Date.now(),
  };
  await db.customExercises.add(exercise);
  return exercise.id;
}
