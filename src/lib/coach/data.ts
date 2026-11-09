import { CATALOG, catalogExercise } from '../catalog/exercises';
import { groupOf, mainGroups, namingSets, type MuscleGroup } from '../catalog/groups';
import { combinedWork, regionsOf, type RegionWork } from '../catalog/regions';
import { daysBetween, toISODate } from '../dates';
import { effectiveHistory, lastPerformance } from '../db/repo';
import { db, newId } from '../db/schema';
import { settings } from '../settings.svelte';
import { hasPain, isOffDay } from '../notes/tags';
import { groupEntries } from '../workout/entries';
import { workoutMinutes } from '../workout/format';
import { groupWork } from '../workout/title';
import type { Baseline, BodyRegion, Exercise, ExerciseNote, ExerciseSettings, Muscle, StallAction, StallRecord, Workout, WorkoutSet } from '../types';
import { bodyLoad, keptTrainingUntil, type BodyLoad } from './balance';
import { compareExercise, pairSets, type ExerciseComparison } from './compare';
import { priorWork, type WorkoutRow } from './fatigue';
import type { FocusHeld } from './focus';
import { expectedGapDays, weekProgress, weeklyFrequency, type WeekProgress } from './frequency';
import { planNextType, rotationTypeCount, typeGroups, type NextPick, type RotationWorkout, type TypeReason, type VariantReason } from './next';
import { alternateRange, lighterWeekActive, resolveOutcomes } from './plateau';
import { countRecent, groupSummaries, type GroupSummary, type Overview } from './overview';
import { adjustPoints, entryRanks, learnPositionCost } from './position';
import { getSameMachine } from './sameMachine';
import { replacementOptions } from './standIn';
import { exerciseStatus, type ExerciseStatus } from './status';
import { atLatestLevel, bodyKg, comparableBefore, isMeasured, markHeldBack, repRange, restartDate, sinceBaseline, strengthPoints, type PriorWork, type Session, type StrengthPoint } from './strength';
import { BREAK_MIN_DAYS, suggestSets, type ReasonCode, type SetPlan, type Suggestion } from './suggest';
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

/** Whole workouts, for working out what came before an exercise in each. */
interface Surroundings {
  perWorkout: Map<string, WorkoutSet[]>;
  exercises: Map<string, Exercise>;
  body: number;
}

/** Finished sets into per-exercise sessions, oldest first. `ranks` covers whole workouts. */
function toSessions(sets: WorkoutSet[], ranks: Ranks, notes?: NoteIndex, around?: Surroundings): Session[] {
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
      const exercise = around?.exercises.get(set.exerciseId);
      if (around && exercise) {
        const prior = priorWork(exercise, around.perWorkout.get(set.workoutId) ?? [], set.entry, around.exercises, around.body);
        if (prior) session.priorWork = prior;
      }
    }
    session.sets.push({ kind: set.kind, weightKg: set.weightKg, reps: set.reps, seconds: set.seconds, failure: set.failure, level: set.level, extra: set.extra });
  }
  return markHeldBack([...sessions.values()]);
}

/** Finished work on every exercise, to see what a muscle did while one of them was away. */
interface Elsewhere {
  work: WorkoutSet[];
  exercises: Map<string, Exercise>;
}

const elsewhere = (sets: WorkoutSet[], exercises: Map<string, Exercise>): Elsewhere => ({
  work: sets.filter((s) => s.kind === 'work' && isMeasured(s)),
  exercises,
});

function buildView(
  exercise: Exercise,
  sessions: Session[],
  stored: Stored,
  today: string,
  training: Training,
  others: Elsewhere,
  position?: number,
  prior?: PriorWork | null,
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
  const latest = compared[compared.length - 1];
  const keptUntil = latest && keptTrainingUntil(exercise, others.work, latest.date, today, others.exercises);
  const suggestion = suggestSets(exercise, compared, {
    today,
    setting,
    status,
    lighterWeek: lighterWeekActive(records, today),
    position,
    priorWork: prior,
    positionCost,
    expectedGapDays,
    keptUntil,
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
async function finishedSets(): Promise<{ sets: WorkoutSet[]; workouts: Map<string, { date: string; minutes?: number }> }> {
  const finished = await db.workouts.where('status').equals('done').toArray();
  const workouts = new Map(finished.map((w) => [w.id, { date: w.date, minutes: workoutMinutes(w) ?? undefined }]));
  const all = await db.sets.toArray();
  return { sets: await effectiveHistory(all.filter((s) => s.done && workouts.has(s.workoutId))), workouts };
}

async function exerciseMap(): Promise<Map<string, Exercise>> {
  const custom = await db.customExercises.toArray();
  return new Map([...CATALOG, ...custom].map((e) => [e.id, e]));
}

/** What the user doesn't want suggested. */
function avoidedIds(saved: Map<string, ExerciseSettings>): Set<string> {
  return new Set([...saved.values()].filter((s) => s.avoid === true).map((s) => s.exerciseId));
}

/**
 * What the coach offers in place of `exerciseId` in a workout, best first. `inWorkout` holds the
 * workout's other exercises, which aren't offered again. What the user has done comes first.
 */
export async function loadReplacements(exerciseId: string, inWorkout: string[]): Promise<{ exercise: Exercise; fresh: boolean }[]> {
  const [exercises, avoided, { sets, workouts }] = await Promise.all([
    exerciseMap(),
    db.exerciseSettings.filter((s) => s.avoid === true).toArray(),
    finishedSets(),
  ]);
  const exercise = exercises.get(exerciseId);
  if (!exercise) return [];
  const lastUsed = new Map<string, string>();
  for (const set of sets) {
    const date = workouts.get(set.workoutId)?.date ?? '';
    if (date > (lastUsed.get(set.exerciseId) ?? '')) lastUsed.set(set.exerciseId, date);
  }
  const done = [...lastUsed.keys()].sort((a, b) => lastUsed.get(a)!.localeCompare(lastUsed.get(b)!));
  return replacementOptions(exercise, exercises, new Set(avoided.map((s) => s.exerciseId)), new Set(inWorkout), done);
}

/** The exercises the user doesn't want suggested, in no particular order. */
export async function avoidedExercises(): Promise<Exercise[]> {
  const [saved, exercises] = await Promise.all([db.exerciseSettings.filter((s) => s.avoid === true).toArray(), exerciseMap()]);
  return saved.flatMap((s) => exercises.get(s.exerciseId) ?? []);
}

/** What the user wants to do now and then. Not suggesting an exercise at all wins over that. */
function sometimesIds(saved: Map<string, ExerciseSettings>): Set<string> {
  return new Set([...saved.values()].filter((s) => s.sometimes === true && s.avoid !== true).map((s) => s.exerciseId));
}

/** The exercises the user wants to do now and then, in no particular order. */
export async function sometimesExercises(): Promise<Exercise[]> {
  const [saved, exercises] = await Promise.all([db.exerciseSettings.filter((s) => s.sometimes === true && s.avoid !== true).toArray(), exerciseMap()]);
  return saved.flatMap((s) => exercises.get(s.exerciseId) ?? []);
}

/** Finished workouts in date order, as the rotation sees them. */
function toRotation(sets: WorkoutSet[], workouts: Map<string, { date: string; minutes?: number }>): RotationWorkout[] {
  const perWorkout = group(sets, (s) => s.workoutId);
  const rotation: RotationWorkout[] = [];
  for (const [id, workout] of workouts) {
    const rows = (perWorkout.get(id) ?? []).sort((a, b) => a.entry - b.entry);
    const workSets: Record<string, number> = {};
    const extra: Record<string, number> = {};
    for (const row of rows) {
      if (row.kind !== 'work') continue;
      workSets[row.exerciseId] = (workSets[row.exerciseId] ?? 0) + 1;
      if (row.extra) extra[row.exerciseId] = (extra[row.exerciseId] ?? 0) + 1;
    }
    const exerciseIds = [...new Set(rows.map((s) => s.exerciseId))];
    rotation.push({ id, date: workout.date, exerciseIds, workSets, extra, ...(workout.minutes !== undefined && { minutes: workout.minutes }) });
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

/**
 * Earlier work planned before this exercise in today's workout, done or not, so the target doesn't
 * move as sets are ticked. The workout is the open one with this exercise at this place, the
 * active one first.
 */
async function plannedPriorWork(exercise: Exercise, position: number, exercises: Map<string, Exercise>): Promise<PriorWork | null> {
  const open = await db.workouts.where('status').anyOf('active', 'planned').toArray();
  for (const workout of open.sort((a, b) => a.status.localeCompare(b.status))) {
    const rows = await db.sets.where('workoutId').equals(workout.id).toArray();
    const entry = [...new Set(rows.map((s) => s.entry))].sort((a, b) => a - b)[position - 1];
    if (rows.find((s) => s.entry === entry)?.exerciseId !== exercise.id) continue;
    return priorWork(exercise, rows, entry, exercises, bodyKg(settings.bodyWeightKg));
  }
  return null;
}

/** Earlier work before an exercise, today and in the session it's compared with. */
export interface PriorWorkPair {
  today: PriorWork | null;
  previous: PriorWork | null;
}

/**
 * For the workout card. Today counts only sets already done above this card, and a live query of
 * this follows them as they're ticked.
 */
export async function loadPriorWork(exerciseId: string, workoutId: string, entry: number, previousWorkoutId: string): Promise<PriorWorkPair> {
  const exercises = await exerciseMap();
  const exercise = exercises.get(exerciseId);
  if (!exercise) return { today: null, previous: null };
  const body = bodyKg(settings.bodyWeightKg);
  const [rows, previousRows] = await Promise.all([
    db.sets.where('workoutId').equals(workoutId).toArray(),
    db.sets.where('workoutId').equals(previousWorkoutId).toArray(),
  ]);
  const previousEntry = Math.min(...previousRows.filter((s) => s.exerciseId === exerciseId).map((s) => s.entry));
  return {
    today: priorWork(exercise, rows.filter((s) => s.done), entry, exercises, body),
    previous: priorWork(exercise, previousRows, previousEntry, exercises, body),
  };
}

/** One exercise, for its page, or for a place in a workout when `position` is given. */
export async function loadExerciseView(id: string, position?: number): Promise<ExerciseView | null> {
  const exercise = catalogExercise(id) ?? (await db.customExercises.get(id));
  if (!exercise) return null;
  const [rows, finished, stored, training, notes, exercises] = await Promise.all([
    db.sets.where('exerciseId').equals(id).toArray(),
    db.workouts.where('status').equals('done').primaryKeys(),
    readStored(),
    loadTraining(),
    db.exerciseNotes.where('exerciseId').equals(id).toArray(),
    exerciseMap(),
  ]);
  const done = new Set(finished);
  const own = await effectiveHistory(rows.filter((s) => s.done && done.has(s.workoutId)));
  // Positions and earlier work depend on the other exercises in those workouts.
  const around = await db.sets.where('workoutId').anyOf([...new Set(own.map((s) => s.workoutId))]).toArray();
  const surroundings = { perWorkout: group(around, (s) => s.workoutId), exercises, body: bodyKg(settings.bodyWeightKg) };
  const sessions = toSessions(own, entryRanks(around), noteIndex(notes), surroundings);
  const prior = position === undefined ? null : await plannedPriorWork(exercise, position, exercises);
  const today = toISODate();
  const latest = sessions[sessions.length - 1];
  // Reading everything is only worth it when this exercise has been away.
  const away = !!latest && daysBetween(latest.date, today) >= BREAK_MIN_DAYS;
  const others = elsewhere(away ? (await finishedSets()).sets : [], exercises);
  return buildView(exercise, sessions, stored, today, training, others, position, prior);
}

export interface ProgressData {
  views: ExerciseView[];
  bests: (NewBest & { exercise: Exercise })[];
  overview: Overview;
  groups: GroupSummary[];
  body: BodyLoad;
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
  const around = { perWorkout: group(sets, (s) => s.workoutId), exercises, body };
  const others = elsewhere(sets, exercises);
  const views: ExerciseView[] = [];
  for (const [id, rows] of group(sets, (s) => s.exerciseId)) {
    const exercise = exercises.get(id);
    if (exercise) views.push(buildView(exercise, toSessions(rows, ranks, noted, around), stored, today, training, others));
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
  const load = bodyLoad(work.filter(isMeasured), [...workouts.values()].map((w) => w.date), exercises, today);
  const avoid = avoidedIds(stored.settings);
  return {
    views,
    bests: allBests.slice(0, BESTS_SHOWN),
    overview: {
      workouts: countRecent([...workouts.values()], today),
      sets: countRecent(entries.map(({ date, workSets }) => ({ date, count: workSets })), today),
      bests: countRecent(allBests, today),
    },
    groups: groupSummaries(views, grouped, today),
    // `others` is what the user could pick up, so it's a suggestion. `shares` is history and stays.
    body: { ...load, regions: load.regions.map((row) => ({ ...row, others: row.others.filter((e) => !avoid.has(e.id)) })) },
    weeks: weeklyVolume(entries, today, WEEKS_OF_VOLUME),
    calendar,
    workouts: workouts.size,
    workoutsInCalendar: calendar.flat().filter((d) => d.trained).length,
  };
}

/** One exercise card in a finished workout, so an exercise done twice reads as it did in the logger. */
export interface SummaryExercise {
  exerciseId: string;
  entry: number;
  /** Missing when the exercise no longer exists. */
  exercise?: Exercise;
  sets: WorkoutSet[];
  /** Against the session before, as the marks in the logger read it. */
  comparison: ExerciseComparison | null;
  /** There's no session before this one. */
  first: boolean;
  /** A machine or gym change lies between this session and the one before, so they aren't compared. */
  restarted: boolean;
  /** A tag says this session doesn't reflect the exercise. */
  offDay: boolean;
}

export interface WorkoutSummary {
  workout: Workout;
  groups: MuscleGroup[];
  /** Null when the time isn't known or can't be right. */
  minutes: number | null;
  workSets: number;
  /** What the work sets trained. Warm-ups don't count, as on the body map in Progress. */
  work: RegionWork;
  exercises: SummaryExercise[];
  /** New bests this workout set, as Progress counts them. */
  bests: (NewBest & { exercise: Exercise })[];
}

/** What a finished workout came to, worked out on reading. Null for any other workout. */
export async function loadWorkoutSummary(id: string): Promise<WorkoutSummary | null> {
  const workout = await db.workouts.get(id);
  if (workout?.status !== 'done') return null;
  const [{ sets: finished }, stored, notes, exercises, { positionCost }] = await Promise.all([
    finishedSets(),
    readStored(),
    db.exerciseNotes.where('workoutId').equals(id).toArray(),
    exerciseMap(),
    loadTraining(),
  ]);
  const sets = finished.filter((s) => s.workoutId === id);
  const body = bodyKg(settings.bodyWeightKg);
  const entries = groupEntries(sets);

  const rows = await Promise.all(
    entries.map(async ({ entry, exerciseId, sets }, index): Promise<SummaryExercise> => {
      const exercise = exercises.get(exerciseId);
      const offDay = isOffDay(notes.filter((n) => n.exerciseId === exerciseId), settings.customTags);
      const row = { exerciseId, entry, exercise, sets, comparison: null, first: false, restarted: false, offDay };
      const last = await lastPerformance(exerciseId, { before: workout.date, excludeWorkoutId: id });
      if (!last) return { ...row, first: true };
      if (!comparableBefore<{ date: string }>(workout, last, stored.baselines.get(exerciseId) ?? [])) return { ...row, restarted: true };
      const work = sets.filter((s) => s.kind === 'work');
      const before = pairSets(work, last.sets).filter((s) => s !== undefined);
      const prior = await loadPriorWork(exerciseId, id, entry, last.workoutId);
      const comparison = compareExercise(work, before, {
        position: index + 1,
        previousPosition: last.position,
        cost: positionCost,
        load: exercise?.load ?? 'weight',
        bodyKg: body,
        offDay,
        priorWork: prior.today,
        previousPriorWork: prior.previous,
      });
      return { ...row, comparison };
    }),
  );

  const ranks = entryRanks(finished);
  const perExercise = group(finished, (s) => s.exerciseId);
  const bests = [...new Set(entries.map((e) => e.exerciseId))].flatMap((exerciseId) => {
    const exercise = exercises.get(exerciseId);
    if (!exercise) return [];
    const compared = atLatestLevel(sinceBaseline(toSessions(perExercise.get(exerciseId) ?? [], ranks), stored.baselines.get(exerciseId) ?? []));
    return newBests(compared, exercise.load, body).filter((b) => b.workoutId === id).map((b) => ({ ...b, exercise }));
  });
  return {
    workout,
    groups: mainGroups(groupWork(sets, exercises)),
    minutes: workoutMinutes(workout),
    workSets: sets.filter((s) => s.kind === 'work').length,
    work: combinedWork(sets.flatMap((s) => (s.kind === 'work' && exercises.has(s.exerciseId) ? [regionsOf(exercises.get(s.exerciseId)!)] : []))),
    exercises: rows,
    bests,
  };
}

/** A rotation type, for typeTitle(). `key` is what switches to it. */
export interface TypeName {
  key: string;
  groups: MuscleGroup[];
  partners: Muscle[];
}

export interface NextWorkout {
  /** What it trains, for typeTitle(). */
  groups: MuscleGroup[];
  /** The muscles in it that this type's days usually train too. */
  partners: Muscle[];
  exercises: { exercise: Exercise; sets: SetPlan[]; suggestion: Suggestion | null }[];
  /** How this week is going against the user's usual number of workouts. */
  week: WeekProgress;
  /** Why this type, when the rotation chose between several. */
  typeReason: { kind: TypeReason['kind']; types: TypeName[] } | null;
  /** The rotation's other types, to switch to. */
  otherTypes: TypeName[];
  /** Why this variant of the type, when the rotation chose between several. */
  reason: { kind: VariantReason['kind']; after: Exercise; lead: Exercise } | null;
  /** The lead exercises of the type's other variants, to switch to. */
  otherVariants: Exercise[];
  /** Exercises taken out, and muscles brought in, to fit the user's usual week. */
  leftOut: Exercise[];
  added: Muscle[];
  /** Exercises brought in for a Focus muscle, and what each replaced, if anything. */
  focus: { exercise: Exercise; region: BodyRegion; fresh: boolean; replaced?: Exercise; overlap?: BodyRegion; otherDay?: true }[];
  /** Exercises with a set more for a Focus muscle, in plan order. */
  extraSets: { exercise: Exercise; region: BodyRegion }[];
  /** Focus would have added more today, but for its share of the week, another muscle's turn or the workout's length. */
  focusHeld?: FocusHeld;
  /** Exercises planned in place of ones the user doesn't want suggested. */
  standIns: { exercise: Exercise; instead: Exercise; fresh: boolean }[];
  /** The exercise marked Sometimes that's in because it's due, when it was last done and what it replaced. */
  sometimes?: { exercise: Exercise; last?: string; replaced?: Exercise };
}

/** Reasons the plan holds back today, which a set more would go against. */
const HOLDS_BACK: readonly ReasonCode[] = ['pain', 'lighterWeek', 'afterBreak', 'afterBreakReps', 'afterBreakTime', 'afterBreakSame', 'climbBack'];

/** A Focus set more goes only where the plan isn't easing off. */
function takesMore(suggestion: Suggestion): boolean {
  return !HOLDS_BACK.includes(suggestion.reason) && !suggestion.params.fewerSets;
}

/**
 * The workout the user's rotation points to, or null with no history. `pick` swaps the suggested
 * type or variant for another.
 */
export async function loadNextWorkout(pick?: NextPick): Promise<NextWorkout | null> {
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
  const plan = planNextType(toRotation(sets, workouts), exercises, { today, perWeek }, pick, settings.regionGoals, avoidedIds(stored.settings), sometimesIds(stored.settings));
  if (!plan) return null;
  const perExercise = group(sets, (s) => s.exerciseId);
  const body = bodyKg(settings.bodyWeightKg);
  const around = { perWorkout: group(sets, (s) => s.workoutId), exercises, body };
  const others = elsewhere(sets, exercises);
  const list: NextWorkout['exercises'] = [];
  const extraSets: NextWorkout['extraSets'] = [];
  const planned: WorkoutRow[] = [];
  for (const id of plan.exerciseIds) {
    const exercise = exercises.get(id);
    if (!exercise) continue;
    const position = list.length + 1;
    const prior = priorWork(exercise, planned, position, exercises, body);
    const view = buildView(exercise, toSessions(perExercise.get(id) ?? [], ranks, noted, around), stored, today, training, others, position, prior);
    const usual = view.suggestion?.sets ?? [];
    const more = plan.extraSets.find((e) => e.exerciseId === id);
    const last = usual.filter((set) => set.kind === 'work').at(-1);
    const sets = more && last && takesMore(view.suggestion!) ? [...usual, { ...last, extra: true }] : usual;
    if (sets !== usual) extraSets.push({ exercise, region: more!.region });
    list.push({ exercise, sets, suggestion: view.suggestion });
    planned.push(...sets.map((set) => ({ ...set, exerciseId: id, entry: position })));
  }
  const groups = mainGroups(list.map((e) => ({ exercise: e.exercise, sets: namingSets(e.sets) })));
  const dates = [...workouts.values()].map((w) => w.date);
  const reason = plan.reason && { kind: plan.reason.kind, after: exercises.get(plan.reason.after)!, lead: exercises.get(plan.reason.lead)! };
  const otherVariants = plan.otherLeads.map((id) => exercises.get(id)!);
  const typeName = (key: string): TypeName => ({ key, groups: typeGroups(key), partners: plan.partners[key] ?? [] });
  const typeReason = plan.typeReason && { kind: plan.typeReason.kind, types: plan.typeReason.types.map(typeName) };
  const partners = typeName(plan.key).partners.filter((muscle) => list.some((e) => e.exercise.muscle === muscle));
  const focus = plan.focus.map(({ exerciseId, region, fresh, replaced, overlap, otherDay }) => ({
    exercise: exercises.get(exerciseId)!,
    region,
    fresh,
    replaced: replaced ? exercises.get(replaced) : undefined,
    overlap,
    otherDay,
  }));
  const standIns = plan.standIns.map(({ exerciseId, instead, fresh }) => ({ exercise: exercises.get(exerciseId)!, instead: exercises.get(instead)!, fresh }));
  const back = plan.sometimes;
  const sometimes = back && { exercise: exercises.get(back.exerciseId)!, last: back.last, replaced: back.replaced ? exercises.get(back.replaced) : undefined };
  return { groups, partners, exercises: list, week: weekProgress(dates, today, perWeek), typeReason, otherTypes: plan.otherTypes.map(typeName), reason, otherVariants, leftOut: plan.leftOut.map((id) => exercises.get(id)!), added: plan.added, focus, extraSets, focusHeld: plan.focusHeld, standIns, sometimes };
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
  const { repLow, repHigh, goal } = view.setting ?? {};
  await db.stallRecords.add({ id: newId(), exerciseId: view.exercise.id, action, date, before: { repLow, repHigh, goal } });
  if (action === 'maintain') await saveExerciseSettings(view.exercise.id, { goal: 'maintain' });
  if (action === 'repRange') {
    const { low, high } = alternateRange(repRange(view.exercise, view.setting, view.compared));
    await saveExerciseSettings(view.exercise.id, { repLow: low, repHigh: high });
  }
}

/** Takes a plateau choice back with what it changed. An older record doesn't say, so that goes back to the default. */
export async function undoStallAction(view: ExerciseView, record: StallRecord): Promise<void> {
  await db.stallRecords.delete(record.id);
  const { repLow, repHigh, goal } = record.before ?? {};
  if (record.action === 'maintain') await saveExerciseSettings(view.exercise.id, { goal });
  if (record.action === 'repRange') await saveExerciseSettings(view.exercise.id, { repLow, repHigh });
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
