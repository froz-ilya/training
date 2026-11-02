import { daysBetween } from '../dates';
import { median } from './position';
import type { Baseline, Equipment, Exercise, ExerciseNote, ExerciseSettings, Load, Muscle, SetKind } from '../types';

/** One exercise in one finished workout. */
export interface Session {
  workoutId: string;
  date: string;
  /** Where the exercise sat in the workout, from 1. */
  position: number;
  sets: SessionSet[];
  /** Comments on the exercise in that workout. */
  notes?: ExerciseNote[];
  /** A tag says this session doesn't reflect the exercise. */
  offDay?: boolean;
  /** The user noted pain in this session. */
  pain?: boolean;
  /** Earlier work in that workout on the muscles this exercise needs. Worked out on reading. */
  priorWork?: PriorWork;
}

/** Hard sets done earlier in a workout that hit an exercise's muscles. See priorWork(). */
export interface PriorWork {
  /** Weighted: a set that hits the muscle only partly counts for part of one. */
  sets: number;
  /** The muscle most of that work went to, for telling the user why. */
  muscle: Muscle;
}

export interface SessionSet {
  kind: SetKind;
  weightKg: number;
  reps: number;
  seconds?: number;
  /** Taken to the point where another rep wasn't possible. */
  failure?: boolean;
  /** The bar or platform height, as numbered in the gym. */
  level?: number;
}

/** One comparable work set, as a session's whole work is compared. Worked out on reading. */
export interface WorkSet {
  /** Estimated strength: kg, or seconds for timed exercises. */
  estimate: number;
  weightKg: number;
  /** 0 for timed sets, which go by their time. */
  reps: number;
}

export interface StrengthPoint {
  date: string;
  /** The session's best estimate: kg, or seconds for timed exercises. */
  value: number;
  /** The comparable work sets in order, when the point comes from a session. */
  work?: WorkSet[];
  /** Where the exercise sat in the workout, when known. */
  position?: number;
  /** Weighted sets done earlier in the workout for the same muscles, when there were any. */
  priorSets?: number;
  /** A tag says this session doesn't reflect the exercise. */
  offDay?: boolean;
}

/** Reps past this say little about strength, so they stop raising the estimate. */
const REP_CAP = 15;
/**
 * Reps count for longer on bodyweight exercises, where more reps are often the only way to progress.
 * Added weight shares this cap: a lower one would score +5 kg × 20 below no added weight × 20.
 */
const BODYWEIGHT_REP_CAP = 30;
/** Only used to compare bodyweight sets with each other when no body weight is set. */
const FALLBACK_BODY_KG = 75;
/** Sessions that show whether an exercise is usually taken to failure, and how many are needed. */
const FAILURE_SESSIONS = 6;
const FAILURE_MIN_SESSIONS = 3;
/** Share of those sessions with a failure set that makes it a habit. */
const FAILURE_HABIT = 0.5;

const DEFAULT_STEP: Record<Equipment, number> = {
  barbell: 2.5,
  smith: 2.5,
  dumbbell: 2,
  cable: 2.5,
  machine: 5,
  bodyweight: 2.5,
  other: 2.5,
};

export function bodyKg(setting: number | undefined): number {
  return setting && setting > 0 ? setting : FALLBACK_BODY_KG;
}

/** Epley estimate of a one-rep max; for timed exercises simply the duration. */
export function estimateSet(set: SessionSet, load: Load, body: number): number {
  if (load === 'time') return set.seconds ?? 0;
  if (set.reps <= 0) return 0;
  const weight = load === 'body' ? set.weightKg + body : set.weightKg;
  if (weight <= 0) return 0;
  const cap = load === 'body' ? BODYWEIGHT_REP_CAP : REP_CAP;
  return weight * (1 + Math.min(set.reps, cap) / 30);
}

/** A light set under this share of the session's best estimate was well short of that day's effort. */
export const RAMP_SHARE = 0.9;

/**
 * Finished sets as they really were. History can hold a ramp-up set stored as `work`, because
 * someone skipped the warm-up tab or a converter guessed. A `work` set reads as a warm-up when it
 * comes before the first set at the top weight, its estimate is under RAMP_SHARE of the session's
 * best, and a later heavier set has at least as many reps. A maximal effort can't be followed by
 * that, whatever its `failure` mark says, so the warm-up drops the mark and new sets don't start
 * from it.
 *
 * Without that proof a light set reads just like the start of a pyramid, where reps fall as the
 * weight climbs, so it stays as stored. So does a set at another level, one with no estimate, and
 * anything timed. Sets after the top weight are back-off sets and are never touched.
 *
 * Worked out on reading and never stored, so the rule can change with no migration. A workout in
 * progress doesn't come through here: what the user marks there stands.
 */
export function effectiveSets<T extends SessionSet>(sets: T[], load: Load, body: number): T[] {
  // A timed set's estimate is its time, which can't weigh added weight against it.
  if (load === 'time') return sets;
  const estimate = (set: SessionSet) => estimateSet(set, load, body);
  const work = sets.filter((s) => s.kind === 'work' && estimate(s) > 0);
  const heaviest = Math.max(...work.map((s) => s.weightKg));
  const lead = work.find((s) => s.weightKg === heaviest);
  if (!lead) return sets;
  // Reps at one level say nothing about another.
  const peers = work.filter((s) => s.level === lead.level);
  const best = Math.max(...peers.map(estimate));
  const before = peers.slice(0, peers.indexOf(lead));
  const ramps = new Set<SessionSet>(
    before.filter(
      (set, i) =>
        estimate(set) < RAMP_SHARE * best && peers.slice(i + 1).some((s) => s.weightKg > set.weightKg && s.reps >= set.reps),
    ),
  );
  return ramps.size ? sets.map((s): T => (ramps.has(s) ? { ...s, kind: 'warmup', failure: undefined } : s)) : sets;
}

/**
 * effectiveSets() for rows from several sessions, which come back in the order given. A session is
 * one exercise in one workout, even when it appears there twice. With no `load` for an exercise,
 * such as one that no longer exists, its sets stay as stored.
 */
export function effectiveRows<T extends SessionSet & { workoutId: string; exerciseId: string; entry: number; order: number }>(
  rows: T[],
  loadOf: (exerciseId: string) => Load | undefined,
  body: number,
): T[] {
  const sessions = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.workoutId}:${row.exerciseId}`;
    const list = sessions.get(key);
    if (list) list.push(row);
    else sessions.set(key, [row]);
  }
  const read = new Map<T, T>();
  for (const list of sessions.values()) {
    const load = loadOf(list[0].exerciseId);
    if (!load) continue;
    const sorted = [...list].sort((a, b) => a.entry - b.entry || a.order - b.order);
    effectiveSets(sorted, load, body).forEach((set, i) => read.set(sorted[i], set));
  }
  return rows.map((row) => read.get(row) ?? row);
}

/** What a session shows in a list: its work sets, or its warm-ups when it had nothing else. */
export function workSets(session: Session): SessionSet[] {
  const work = session.sets.filter((s) => s.kind === 'work');
  return work.length ? work : session.sets;
}

/** A set with a result. A logged attempt with no reps or time says nothing about strength. */
export function isMeasured(set: SessionSet): boolean {
  return set.reps > 0 || (set.seconds ?? 0) > 0;
}

/** The sets a session is measured by. Warm-ups never stand in for work, and failed attempts don't count. */
export function doneWork(session: Session): SessionSet[] {
  return session.sets.filter((s) => s.kind === 'work' && isMeasured(s));
}

/** Done work at the level the session is judged by. A set with no level recorded stays in. */
export function comparableSets(session: Session): SessionSet[] {
  const sets = doneWork(session);
  const level = leadSet(session)?.level;
  return level === undefined ? sets : sets.filter((s) => s.level === undefined || s.level === level);
}

/** The session's best estimate, or null when nothing in it can be measured. */
export function sessionStrength(session: Session, load: Load, body: number): number | null {
  const best = Math.max(0, ...comparableSets(session).map((s) => estimateSet(s, load, body)));
  return best > 0 ? best : null;
}

export function strengthPoints(sessions: Session[], load: Load, body: number): StrengthPoint[] {
  const points: StrengthPoint[] = [];
  for (const session of sessions) {
    const value = sessionStrength(session, load, body);
    if (value === null) continue;
    const work = comparableSets(session).map(({ weightKg, reps, ...set }) => ({
      estimate: estimateSet({ weightKg, reps, ...set }, load, body),
      weightKg,
      reps: load === 'time' ? 0 : reps,
    }));
    const point: StrengthPoint = { date: session.date, value, work, position: session.position };
    if (session.priorWork) point.priorSets = session.priorWork.sets;
    if (session.offDay) point.offDay = true;
    points.push(point);
  }
  return points;
}

const reachedFailure = (session: Session) => session.sets.some((s) => s.kind === 'work' && s.failure);

/**
 * Failure sets are how this exercise is usually done, so a session without one was held back and
 * wasn't a fair test. It counts as an off day, which means a new best in it still counts.
 */
export function markHeldBack(sessions: Session[]): Session[] {
  return sessions.map((session, i) => {
    const before = sessions.slice(Math.max(0, i - FAILURE_SESSIONS), i);
    const habit = before.length >= FAILURE_MIN_SESSIONS && before.filter(reachedFailure).length / before.length >= FAILURE_HABIT;
    const worked = session.sets.some((s) => s.kind === 'work');
    return habit && worked && !reachedFailure(session) ? { ...session, offDay: true } : session;
  });
}

/**
 * Sessions that speak for the exercise. One with no result is left out, and so is an off day,
 * unless it set a new best.
 */
export function countedSessions(sessions: Session[], load: Load, body: number): Session[] {
  let best = 0;
  return sessions.filter((session) => {
    if (!leadSet(session)) return false;
    const value = sessionStrength(session, load, body) ?? 0;
    if (session.offDay && value <= best) return false;
    best = Math.max(best, value);
    return true;
  });
}

/** The heaviest set, and the one with the most reps at that weight. */
export function topSet(session: Session): SessionSet | null {
  let top: SessionSet | null = null;
  for (const set of comparableSets(session)) {
    if (!top) top = set;
    else if (set.weightKg > top.weightKg) top = set;
    else if (set.weightKg === top.weightKg && (set.reps > top.reps || (set.seconds ?? 0) > (top.seconds ?? 0))) top = set;
  }
  return top;
}

/**
 * The set a session is judged by: the first at its heaviest weight, when the user was freshest.
 * Sets taken to failure fall from one to the next, so later sets say nothing about weakness.
 */
export function leadSet(session: Session): SessionSet | null {
  const sets = doneWork(session);
  if (!sets.length) return null;
  const heaviest = Math.max(...sets.map((s) => s.weightKg));
  return sets.find((s) => s.weightKg === heaviest) ?? null;
}

/**
 * Usual days between sessions, from the latest few. An exercise trained once a month isn't "on a
 * break" after three weeks, so breaks are judged against this.
 */
export function typicalGap(dates: string[]): number {
  const recent = dates.slice(-9);
  const gaps = recent.slice(1).map((date, i) => daysBetween(recent[i], date));
  if (!gaps.length) return 0;
  return gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
}

/**
 * Reps at one level say nothing about another, and whether higher is easier depends on the exercise.
 * So comparisons stay at the latest level recorded. A session with no level recorded stays in.
 */
export function atLatestLevel(sessions: Session[]): Session[] {
  let latest: number | undefined;
  for (let i = sessions.length - 1; i >= 0 && latest === undefined; i--) latest = leadSet(sessions[i])?.level;
  if (latest === undefined) return sessions;
  return sessions.filter((session) => {
    const level = leadSet(session)?.level;
    return level === undefined || level === latest;
  });
}

const latestBaseline = (baselines: Baseline[]) => baselines.reduce((latest, b) => (b.date > latest ? b.date : latest), '');

/** Comparisons start at the latest machine or gym change. */
export function sinceBaseline<T extends { date: string }>(items: T[], baselines: Baseline[]): T[] {
  const from = latestBaseline(baselines);
  return from ? items.filter((i) => i.date >= from) : items;
}

/** The latest change, when there's history before it: the comparison restarted, not began. */
export function restartDate(sessions: { date: string }[], baselines: Baseline[]): string | undefined {
  const from = latestBaseline(baselines);
  return from && sessions.some((s) => s.date < from) ? from : undefined;
}

/** The session another is held against: none when a machine or gym change lies between the two. */
export function comparableBefore<T extends { date: string }>(session: T, before: T | undefined, baselines: { date: string }[]): T | undefined {
  // A session on the day of a change already counts as after it, like sinceBaseline.
  return before && baselines.some((b) => before.date < b.date && b.date <= session.date) ? undefined : before;
}

export interface RepRange {
  low: number;
  high: number;
}

/** Sessions the usual reps come from, and how many are needed before they count as a habit. */
const HABIT_SESSIONS = 6;
const HABIT_MIN_SESSIONS = 3;

/**
 * The reps to work in: the user's own setting, else the usual range for the exercise. When someone
 * habitually works outside that range it follows their habit, so their normal numbers never read
 * as too low or too high: always doing 4 gives about 3–6.
 */
export function repRange(exercise: Exercise, setting?: ExerciseSettings, sessions: Session[] = []): RepRange {
  const fallback = exercise.compound ? { low: 6, high: 10 } : { low: 8, high: 12 };
  if (setting?.repLow !== undefined || setting?.repHigh !== undefined) {
    const low = setting.repLow ?? fallback.low;
    const high = setting.repHigh ?? fallback.high;
    return high > low ? { low, high } : fallback;
  }
  const leads = sessions.slice(-HABIT_SESSIONS).flatMap((s) => {
    const reps = leadSet(s)?.reps ?? 0;
    return reps > 0 ? [reps] : [];
  });
  if (leads.length < HABIT_MIN_SESSIONS) return fallback;
  const usual = Math.round(median(leads));
  if (usual >= fallback.low && usual <= fallback.high) return fallback;
  return { low: Math.max(1, usual - 1), high: usual + 2 };
}

/**
 * The step this user actually moves in: the most common gap between the weights they've used,
 * the smaller one on a tie. Needs a few distinct weights; a fixed default stands in until then.
 */
export function learnStep(weights: number[]): number | null {
  const distinct = [...new Set(weights.filter((w) => w > 0))].sort((a, b) => a - b);
  if (distinct.length < 3) return null;
  const top = distinct[distinct.length - 1];
  const gaps = new Map<number, number>();
  for (let i = 1; i < distinct.length; i++) {
    const gap = Math.round((distinct[i] - distinct[i - 1]) * 1000) / 1000;
    if (gap > Math.max(top * 0.15, 2.5)) continue;
    gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
  }
  let best: number | null = null;
  let count = 0;
  for (const [gap, n] of gaps) {
    if (n > count || (n === count && best !== null && gap < best)) {
      best = gap;
      count = n;
    }
  }
  return best;
}

/** Sessions the step is learned from. */
const STEP_SESSIONS = 16;

export function weightStep(exercise: Exercise, sessions: Session[], setting?: ExerciseSettings): number {
  if (setting?.stepKg && setting.stepKg > 0) return setting.stepKg;
  const recent = sessions.slice(-STEP_SESSIONS);
  const weights = recent.flatMap((s) => doneWork(s).map((set) => set.weightKg));
  return learnStep(weights) ?? DEFAULT_STEP[exercise.equipment];
}
