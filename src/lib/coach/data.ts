import { CATALOG, catalogExercise } from '../catalog/exercises';
import { groupOf, mainGroups, type MuscleGroup } from '../catalog/groups';
import { toISODate } from '../dates';
import { db, newId } from '../db/schema';
import { settings } from '../settings.svelte';
import { hasPain, isOffDay } from '../notes/tags';
import type { Baseline, Exercise, ExerciseNote, ExerciseSettings, StallAction, StallRecord, WorkoutSet } from '../types';
import { expectedGapDays, weekProgress, weeklyFrequency, type WeekProgress } from './frequency';
import { planNextType, rotationTypeCount, type RotationWorkout } from './next';
import { alternateRange, lighterWeekActive, resolveOutcomes } from './plateau';
import { countRecent, groupSummaries, type GroupSummary, type Overview } from './overview';
import { adjustPoints, entryRanks, learnPositionCost } from './position';
import { getSameMachine } from './sameMachine';
import { exerciseStatus, type ExerciseStatus } from './status';
import { atLatestLevel, bodyKg, markHeldBack, repRange, restartDate, sinceBaseline, strengthPoints, type Session, type StrengthPoint } from './strength';
import { suggestSets, type SetPlan, type Suggestion } from './suggest';
import { calendarWeeks, newBests, weeklyVolume, type CalendarDay, type NewBest, type WeekVolume } from './summary';

/** Everything the coach knows about one exercise. */
export interface ExerciseView {
  exercise: Exercise;
  /** All sessions, oldest first. */
  sessions: Session[];
  /** Sessions since the latest machine or gym change, at the latest level. */
  compared: Session[];
  points: StrengthPoint[];
  setting?: ExerciseSettings;
  baselines: Baseline[];
  records: StallRecord[];
  status: ExerciseStatus;
  suggestion: Suggestion | null;
  /** Workouts a week, and the days the rotation takes at that pace. */
  perWeek: number;
  expectedGapDays: number;
}

/** What the coach knows about the user's training as a whole. */
interface Training {
  positionCost: number;
  perWeek: number;
  expectedGapDays: number;
}

interface Stored {
  settings: Map<string, ExerciseSettings>;
  baselines: Map<string, Baseline[]>;
  records: Map<string, StallRecord[]>;
}

function group<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

type Ranks = ReturnType<typeof entryRanks>;
type NoteIndex = Map<string, ExerciseNote[]>;

const noteKey = (workoutId: string, exerciseId: string) => `${workoutId}:${exerciseId}`;
const noteIndex = (notes: ExerciseNote[]): NoteIndex => group(notes, (n) => noteKey(n.workoutId, n.exerciseId));

/** Finished sets into per-exercise sessions, oldest first. `ranks` covers whole workouts. */
function toSessions(sets: WorkoutSet[], ranks: Ranks, notes?: NoteIndex): Session[] {
  const sorted = [...sets].sort((a, b) => a.date.localeCompare(b.date) || a.entry - b.entry || a.order - b.order);
  const sessions = new Map<string, Session>();
  for (const set of sorted) {
    let session = sessions.get(set.workoutId);
    if (!session) {
      const position = ranks.get(set.workoutId)?.get(set.entry) ?? 1;
      sessions.set(set.workoutId, (session = { workoutId: set.workoutId, date: set.date, position, sets: [] }));
      const own = notes?.get(noteKey(set.workoutId, set.exerciseId));
      if (own) {
        session.notes = own;
        session.offDay = isOffDay(own, settings.customTags);
        session.pain = hasPain(own);
      }
    }
    session.sets.push({ kind: set.kind, weightKg: set.weightKg, reps: set.reps, seconds: set.seconds, failure: set.failure, level: set.level });
  }
  return markHeldBack([...sessions.values()]);
}

function buildView(
  exercise: Exercise,
  sessions: Session[],
  stored: Stored,
  today: string,
  training: Training,
  position?: number,
): ExerciseView {
  const body = bodyKg(settings.bodyWeightKg);
  const setting = stored.settings.get(exercise.id);
  const baselines = stored.baselines.get(exercise.id) ?? [];
  const records = stored.records.get(exercise.id) ?? [];
  const compared = atLatestLevel(sinceBaseline(sessions, baselines));
  const points = strengthPoints(compared, exercise.load, body);
  const ignoreFall = getSameMachine().has(exercise.id);
  const { positionCost, perWeek, expectedGapDays } = training;
  const restartedOn = restartDate(sessions, baselines);
  const status = exerciseStatus(points, { today, goal: setting?.goal, ignoreFall, positionCost, expectedGapDays, restartedOn });
  const suggestion = suggestSets(exercise, compared, {
    today,
    setting,
    status,
    lighterWeek: lighterWeekActive(records, today),
    position,
    expectedGapDays,
    body,
  });
  return { exercise, sessions, compared, points, setting, baselines, records, status, suggestion, perWeek, expectedGapDays };
}

async function readStored(): Promise<Stored> {
  const [list, baselines, records] = await Promise.all([
    db.exerciseSettings.toArray(),
    db.baselines.toArray(),
    db.stallRecords.toArray(),
  ]);
  return {
    settings: new Map(list.map((s) => [s.exerciseId, s])),
    baselines: group(baselines, (b) => b.exerciseId),
    records: group(records, (r) => r.exerciseId),
  };
}

/** Only sets from finished workouts count, and only the ones actually done. */
async function finishedSets(): Promise<{ sets: WorkoutSet[]; workouts: Map<string, { date: string }> }> {
  const finished = await db.workouts.where('status').equals('done').toArray();
  const workouts = new Map(finished.map((w) => [w.id, { date: w.date }]));
  const all = await db.sets.toArray();
  return { sets: all.filter((s) => s.done && workouts.has(s.workoutId)), workouts };
}

async function exerciseMap(): Promise<Map<string, Exercise>> {
  const custom = await db.customExercises.toArray();
  return new Map([...CATALOG, ...custom].map((e) => [e.id, e]));
}

/** Finished workouts in date order, as the rotation sees them. */
function toRotation(sets: WorkoutSet[], workouts: Map<string, { date: string }>): RotationWorkout[] {
  const perWorkout = group(sets, (s) => s.workoutId);
  const rotation: RotationWorkout[] = [];
  for (const [id, workout] of workouts) {
    const rows = (perWorkout.get(id) ?? []).sort((a, b) => a.entry - b.entry);
    const workSets: Record<string, number> = {};
    for (const row of rows) if (row.kind === 'work') workSets[row.exerciseId] = (workSets[row.exerciseId] ?? 0) + 1;
    rotation.push({ id, date: workout.date, exerciseIds: [...new Set(rows.map((s) => s.exerciseId))], workSets });
  }
  return rotation.sort((a, b) => a.date.localeCompare(b.date));
}

interface Habits {
  positionCost: number;
  dates: string[];
  rotationTypes: number;
}

let habits: { workouts: number; value: Promise<Habits> } | null = null;

/** Worked out once, and again after each finished workout. */
function loadHabits(workouts: number): Promise<Habits> {
  if (habits?.workouts !== workouts) habits = { workouts, value: learnHabits() };
  return habits.value;
}

async function learnHabits(): Promise<Habits> {
  const [{ sets, workouts }, exercises] = await Promise.all([finishedSets(), exerciseMap()]);
  const ranks = entryRanks(sets);
  const body = bodyKg(settings.bodyWeightKg);
  const points: StrengthPoint[][] = [];
  for (const [id, rows] of group(sets, (s) => s.exerciseId)) {
    const exercise = exercises.get(id);
    if (exercise) points.push(strengthPoints(toSessions(rows, ranks), exercise.load, body));
  }
  return {
    positionCost: learnPositionCost(points),
    dates: [...workouts.values()].map((w) => w.date),
    rotationTypes: rotationTypeCount(toRotation(sets, workouts), exercises),
  };
}

async function loadTraining(): Promise<Training> {
  const { positionCost, dates, rotationTypes } = await loadHabits(await db.workouts.where('status').equals('done').count());
  const perWeek = weeklyFrequency(dates, settings.workoutsPerWeek);
  return { positionCost, perWeek, expectedGapDays: expectedGapDays(perWeek, rotationTypes) };
}

/** The user's own cost of a later position. */
export async function loadPositionCost(): Promise<number> {
  return (await loadTraining()).positionCost;
}

/** One exercise, for its page, or for a place in a workout when `position` is given. */
export async function loadExerciseView(id: string, position?: number): Promise<ExerciseView | null> {
  const exercise = catalogExercise(id) ?? (await db.customExercises.get(id));
  if (!exercise) return null;
  const [rows, finished, stored, training, notes] = await Promise.all([
    db.sets.where('exerciseId').equals(id).toArray(),
    db.workouts.where('status').equals('done').primaryKeys(),
    readStored(),
    loadTraining(),
    db.exerciseNotes.where('exerciseId').equals(id).toArray(),
  ]);
  const done = new Set(finished);
  const own = rows.filter((s) => s.done && done.has(s.workoutId));
  // Positions depend on the other exercises in those workouts.
  const around = await db.sets.where('workoutId').anyOf([...new Set(own.map((s) => s.workoutId))]).toArray();
  return buildView(exercise, toSessions(own, entryRanks(around), noteIndex(notes)), stored, toISODate(), training, position);
}

export interface ProgressData {
  views: ExerciseView[];
  bests: (NewBest & { exercise: Exercise })[];
  overview: Overview;
  groups: GroupSummary[];
  weeks: WeekVolume[];
  calendar: CalendarDay[][];
  workouts: number;
  workoutsInCalendar: number;
}

const WEEKS_OF_VOLUME = 12;
const WEEKS_OF_CALENDAR = 26;
const BESTS_SHOWN = 12;

export async function loadProgress(): Promise<ProgressData> {
  const today = toISODate();
  const [{ sets, workouts }, stored, exercises, training, notes] = await Promise.all([
    finishedSets(),
    readStored(),
    exerciseMap(),
    loadTraining(),
    db.exerciseNotes.toArray(),
  ]);
  const body = bodyKg(settings.bodyWeightKg);
  const ranks = entryRanks(sets);
  const noted = noteIndex(notes);
  const views: ExerciseView[] = [];
  for (const [id, rows] of group(sets, (s) => s.exerciseId)) {
    const exercise = exercises.get(id);
    if (exercise) views.push(buildView(exercise, toSessions(rows, ranks, noted), stored, today, training));
  }
  const allBests = views
    .flatMap((v) => newBests(v.compared, v.exercise.load, body).map((b) => ({ ...b, exercise: v.exercise })))
    .sort((a, b) => b.date.localeCompare(a.date));
  const work = sets.filter((s) => s.kind === 'work');
  const perDate = group(work, (s) => s.date);
  const entries = [...perDate].map(([date, list]) => ({ date, workSets: list.length }));
  const days = new Set([...workouts.values()].map((w) => w.date));
  const calendar = calendarWeeks(days, today, WEEKS_OF_CALENDAR);
  const grouped = work.flatMap((s) => {
    const exercise = exercises.get(s.exerciseId);
    return exercise ? [{ date: s.date, group: groupOf(exercise.muscle) }] : [];
  });
  return {
    views,
    bests: allBests.slice(0, BESTS_SHOWN),
    overview: {
      workouts: countRecent([...workouts.values()], today),
      sets: countRecent(entries.map(({ date, workSets }) => ({ date, count: workSets })), today),
      bests: countRecent(allBests, today),
    },
    groups: groupSummaries(views, grouped, today),
    weeks: weeklyVolume(entries, today, WEEKS_OF_VOLUME),
    calendar,
    workouts: workouts.size,
    workoutsInCalendar: calendar.flat().filter((d) => d.trained).length,
  };
}

export interface NextWorkout {
  /** What it trains, for workoutTitle(). */
  groups: MuscleGroup[];
  exercises: { exercise: Exercise; sets: SetPlan[]; suggestion: Suggestion | null }[];
  /** How this week is going against the user's usual number of workouts. */
  week: WeekProgress;
}

/** The workout the user's rotation points to, or null with no history. */
export async function loadNextWorkout(): Promise<NextWorkout | null> {
  const today = toISODate();
  const [{ sets, workouts }, stored, exercises, training, notes] = await Promise.all([
    finishedSets(),
    readStored(),
    exerciseMap(),
    loadTraining(),
    db.exerciseNotes.toArray(),
  ]);
  const ranks = entryRanks(sets);
  const noted = noteIndex(notes);
  const { perWeek } = training;
  const plan = planNextType(toRotation(sets, workouts), exercises, { today, perWeek });
  if (!plan) return null;
  const perExercise = group(sets, (s) => s.exerciseId);
  const list: NextWorkout['exercises'] = [];
  for (const id of plan.exerciseIds) {
    const exercise = exercises.get(id);
    if (!exercise) continue;
    const position = list.length + 1;
    const view = buildView(exercise, toSessions(perExercise.get(id) ?? [], ranks, noted), stored, today, training, position);
    list.push({ exercise, sets: view.suggestion?.sets ?? [], suggestion: view.suggestion });
  }
  const groups = mainGroups(list.map((e) => ({ muscle: e.exercise.muscle, sets: e.sets.filter((s) => s.kind === 'work').length })));
  const dates = [...workouts.values()].map((w) => w.date);
  return { groups, exercises: list, week: weekProgress(dates, today, perWeek) };
}

// ---------- Saving ----------

export async function saveExerciseSettings(exerciseId: string, patch: Partial<Omit<ExerciseSettings, 'exerciseId'>>): Promise<void> {
  const saved = await db.exerciseSettings.get(exerciseId);
  await db.exerciseSettings.put({ ...saved, ...patch, exerciseId });
}

export async function addBaseline(exerciseId: string, note?: string, date = toISODate()): Promise<void> {
  await db.baselines.add({ id: newId(), exerciseId, date, note });
}

export async function removeBaseline(id: string): Promise<void> {
  await db.baselines.delete(id);
}

/** Records a plateau choice and applies what it changes. */
export async function chooseStallAction(view: ExerciseView, action: StallAction): Promise<void> {
  const date = toISODate();
  // A second tap the same day isn't a second attempt.
  if (view.records.some((r) => r.action === action && r.date === date)) return;
  await db.stallRecords.add({ id: newId(), exerciseId: view.exercise.id, action, date });
  if (action === 'maintain') await saveExerciseSettings(view.exercise.id, { goal: 'maintain' });
  if (action === 'repRange') {
    const { low, high } = alternateRange(repRange(view.exercise, view.setting, view.compared));
    await saveExerciseSettings(view.exercise.id, { repLow: low, repHigh: high });
  }
}

/** Fills in the outcome of past plateau choices. Runs when the progress pages open. */
export async function syncStallOutcomes(): Promise<void> {
  const records = await db.stallRecords.filter((r) => r.helped === undefined).toArray();
  if (!records.length) return;
  const today = toISODate();
  const body = bodyKg(settings.bodyWeightKg);
  const { positionCost } = await loadTraining();
  const changed: StallRecord[] = [];
  for (const [id, list] of group(records, (r) => r.exerciseId)) {
    const view = await loadExerciseView(id);
    if (!view) continue;
    // Moving an exercise earlier isn't a new best, so it can't show that a choice helped.
    const points = adjustPoints(strengthPoints(view.compared, view.exercise.load, body), positionCost);
    changed.push(...resolveOutcomes(list, points, today));
  }
  if (changed.length) await db.stallRecords.bulkPut(changed);
}
