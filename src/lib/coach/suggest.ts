import { daysBetween } from '../dates';
import type { Exercise, ExerciseSettings, Load, SetKind } from '../types';
import type { ExerciseStatus } from './status';
import { median } from './position';
import {
  bodyKg,
  countedSessions,
  doneWork,
  leadSet,
  repRange,
  topSet,
  typicalGap,
  weightStep,
  type Session,
  type SessionSet,
} from './strength';

export interface SetPlan {
  kind: SetKind;
  weightKg: number;
  reps: number;
  seconds?: number;
  level?: number;
  failure?: boolean;
}

export type ReasonCode =
  | 'up'
  | 'moreReps'
  | 'moreTime'
  | 'hold'
  | 'down'
  | 'afterBreak'
  | 'afterBreakReps'
  | 'afterBreakTime'
  | 'afterBreakSame'
  | 'maintain'
  | 'noIncrease'
  | 'lighterWeek'
  | 'pain'
  | 'laterInWorkout'
  | 'earlierInWorkout';

export interface Suggestion {
  weightKg: number;
  reps: number;
  seconds?: number;
  sets: SetPlan[];
  reason: ReasonCode;
  /** What the reason's text needs. */
  params: {
    weightKg: number;
    reps: number;
    seconds: number;
    target: number;
    low: number;
    high: number;
    days: number;
    load: Load;
    /** The session this builds on, when it isn't the latest one. */
    baseDate?: string;
  };
}

export interface SuggestOptions {
  today: string;
  setting?: ExerciseSettings;
  status?: ExerciseStatus;
  /** The user chose a lighter week for this exercise. */
  lighterWeek?: boolean;
  /** Where the exercise sits in today's workout, from 1. */
  position?: number;
  /** Days a rotation normally takes at the user's weekly frequency. */
  expectedGapDays?: number;
  /** Used to compare bodyweight sets. */
  body?: number;
}

const BREAK_SHORT_DAYS = 14;
const BREAK_LONG_DAYS = 21;
/** A break also has to be this many times the exercise's usual gap. */
const BREAK_SHORT_GAPS = 1.5;
const BREAK_LONG_GAPS = 2.25;
const BREAK_SHORT = 0.95;
const BREAK_LONG = 0.9;
const LIGHTER_WEEK = 0.9;
/** Warm-ups stay as last time while the top weight is within this share of last time's. */
const SIMILAR_TOP = 0.15;
/** A warm-up ramp for when the user's own pattern doesn't fit: share of top weight × reps. */
const RAMP = [
  [0.4, 12],
  [0.6, 8],
  [0.8, 4],
] as const;
const TIME_STEP_SECONDS = 5;
/** How far back a session at the same position can be the starting point. */
const RECENT_SESSIONS = 4;
/** Reps a later position takes off, at most. */
const MAX_LATER_DROP = 2;
const DEFAULT_WORK_SETS = 3;
/** Sessions the usual number of work sets comes from. */
const USUAL_SETS_SESSIONS = 6;

/** A plan stays at the height the set was done at, and adds nothing when it has none. */
const atLevel = (level: number | undefined) => (level === undefined ? {} : { level });

/** How many work sets this user usually does for this exercise. */
export function usualWorkSets(history: Session[]): number {
  const counts = history.slice(-USUAL_SETS_SESSIONS).map((s) => doneWork(s).length).filter(Boolean);
  return counts.length ? Math.max(1, Math.round(median(counts))) : DEFAULT_WORK_SETS;
}

/** Sessions to go by: the latest one at today's position, else a neighbouring one, else the latest. */
function baseSession(history: Session[], position: number | undefined): Session | undefined {
  const latest = history[history.length - 1];
  if (position === undefined) return latest;
  const recent = history.slice(-RECENT_SESSIONS).reverse();
  return recent.find((s) => s.position === position) ?? recent.find((s) => Math.abs(s.position - position) <= 1) ?? latest;
}

/** Moves from a weight the user has loaded before, so the result is always one they can load. */
function stepsFrom(anchor: number, target: number, step: number): number {
  const value = anchor + Math.round((target - anchor) / step) * step;
  return Math.max(0, Math.round(value * 1000) / 1000);
}

/**
 * About `share` of what was done. A step down when one fits; when the step is too big for that, the
 * same weight with fewer reps, so the plan really is lighter. Unchanged only at a single rep with
 * no weight to take off. `repDrop` is what later sets at that weight lose too.
 */
function eased(top: SessionSet, share: number, step: number): { weightKg: number; reps: number; repDrop: number } {
  const weightKg = stepsFrom(top.weightKg, top.weightKg * share, step);
  if (weightKg < top.weightKg) return { weightKg, reps: top.reps, repDrop: 0 };
  const repDrop = Math.max(1, Math.round(top.reps * (1 - share)));
  const reps = Math.min(top.reps, Math.max(1, Math.ceil(top.reps) - repDrop));
  return { weightKg: top.weightKg, reps, repDrop: reps < top.reps ? repDrop : 0 };
}

/** About `share` of a duration, at least one time step shorter; unchanged when that leaves nothing. */
function easedSeconds(seconds: number, share: number): number {
  const target = Math.min(stepsFrom(seconds, seconds * share, TIME_STEP_SECONDS), seconds - TIME_STEP_SECONDS);
  return target > 0 ? target : seconds;
}

/** What a planned set keeps from the same set last time. */
function carried(set: SessionSet): Pick<SetPlan, 'level' | 'failure'> {
  return { ...atLevel(set.level), ...(set.failure ? { failure: true } : {}) };
}

function warmUps(last: Session, top: number, lastTop: number, step: number, compound: boolean, level: number | undefined): SetPlan[] {
  const own = last.sets.filter((s) => s.kind === 'warmup');
  if (own.length && lastTop > 0 && Math.abs(top - lastTop) / lastTop <= SIMILAR_TOP) {
    return own.map((s) => ({ kind: 'warmup', weightKg: s.weightKg, reps: s.reps, ...atLevel(level) }));
  }
  if (!own.length && !compound) return [];
  const ramp: SetPlan[] = [];
  for (const [share, reps] of RAMP) {
    const weightKg = stepsFrom(top, top * share, step);
    if (weightKg > 0 && !ramp.some((s) => s.weightKg === weightKg)) ramp.push({ kind: 'warmup', weightKg, reps, ...atLevel(level) });
  }
  return ramp;
}

/**
 * The usual work sets. Each one expects what the same set did last time, so sets to failure keep
 * falling from one to the next. Only the lead set carries the target; a lighter back-off set keeps
 * its share of the weight, and a set at full weight never expects more than the lead.
 */
function workPlan(
  last: Session,
  lead: SessionSet,
  weightKg: number,
  reps: number,
  step: number,
  repDrop: number,
  count: number,
): SetPlan[] {
  const sets = doneWork(last);
  const needed = Math.max(count, sets.indexOf(lead) + 1);
  let usedLead = false;
  return Array.from({ length: needed }, (_, i): SetPlan => {
    const set = sets[Math.min(i, sets.length - 1)];
    if (!usedLead && set === lead) {
      usedLead = true;
      return { kind: 'work', weightKg, reps, ...carried(set) };
    }
    const share = lead.weightKg > 0 ? set.weightKg / lead.weightKg : 1;
    const expected = Math.max(1, set.reps - repDrop);
    if (share >= 1) return { kind: 'work', weightKg, reps: Math.min(expected, reps), ...carried(set) };
    return { kind: 'work', weightKg: stepsFrom(weightKg, weightKg * share, step), reps: expected, ...carried(set) };
  });
}

function timedSuggestion(last: Session, top: SessionSet, reason: ReasonCode, params: Suggestion['params']): Suggestion {
  const seconds = params.target;
  const shorter = seconds < (top.seconds ?? 0);
  const sets = doneWork(last).map((set) => ({
    kind: 'work' as const,
    weightKg: set.weightKg,
    reps: 0,
    seconds: set === top || (shorter && (set.seconds ?? 0) > seconds) ? seconds : set.seconds,
    ...carried(set),
  }));
  return { weightKg: top.weightKg, reps: 0, seconds, sets, reason, params };
}

/**
 * What to do today, from the sessions since the latest baseline. Null with no history: there's
 * nothing to go on, and a guessed weight for someone's first session wouldn't be safe.
 */
export function suggestSets(exercise: Exercise, history: Session[], options: SuggestOptions): Suggestion | null {
  const { today, setting, status, lighterWeek, position, expectedGapDays = 0, body } = options;
  // An off day says nothing about the next session, so it's never the starting point.
  const counted = countedSessions(history, exercise.load, bodyKg(body));
  const last = baseSession(counted, position);
  // Increases go by the lead set; a later set's low reps are just what failure looks like.
  const top = last && (exercise.load === 'time' ? topSet(last) : leadSet(last));
  if (!last || !top) return null;

  const { low, high } = repRange(exercise, setting, counted);
  const latest = history[history.length - 1];
  const days = daysBetween(latest.date, today);
  /** Positive when today's slot is later in the workout than the session this builds on. */
  const slots = position === undefined ? 0 : position - last.position;
  const step = weightStep(exercise, history, setting);
  const lastSeconds = top.seconds ?? 0;
  const baseDate = last === latest ? undefined : last.date;
  const params = { weightKg: top.weightKg, reps: top.reps, seconds: lastSeconds, target: top.reps, low, high, days, load: exercise.load, baseDate };
  const gap = Math.max(typicalGap(history.map((s) => s.date)), expectedGapDays);
  const shortBreak = Math.max(BREAK_SHORT_DAYS, BREAK_SHORT_GAPS * gap);
  const longBreak = Math.max(BREAK_LONG_DAYS, BREAK_LONG_GAPS * gap);
  const breakShare = days >= longBreak ? BREAK_LONG : days >= shortBreak ? BREAK_SHORT : null;

  if (exercise.load === 'time') {
    if (lighterWeek) return timedSuggestion(last, top, 'lighterWeek', { ...params, target: easedSeconds(lastSeconds, LIGHTER_WEEK) });
    if (breakShare !== null) {
      const target = easedSeconds(lastSeconds, breakShare);
      return timedSuggestion(last, top, target < lastSeconds ? 'afterBreakTime' : 'afterBreakSame', { ...params, target });
    }
    const hold = setting?.goal === 'maintain';
    if (hold || latest.pain || slots > 0) {
      const reason = hold ? 'maintain' : latest.pain ? 'pain' : 'laterInWorkout';
      return timedSuggestion(last, top, reason, { ...params, target: lastSeconds });
    }
    return timedSuggestion(last, top, 'moreTime', { ...params, target: lastSeconds + TIME_STEP_SECONDS });
  }

  const noIncrease = status?.state === 'stalled' || status?.state === 'dropping';
  let weightKg = top.weightKg;
  let reps = top.reps;
  let repDrop = 0;
  let reason: ReasonCode;

  if (lighterWeek) {
    ({ weightKg, reps, repDrop } = eased(top, LIGHTER_WEEK, step));
    reason = 'lighterWeek';
  } else if (breakShare !== null) {
    ({ weightKg, reps, repDrop } = eased(top, breakShare, step));
    reason = weightKg < top.weightKg ? 'afterBreak' : reps < top.reps ? 'afterBreakReps' : 'afterBreakSame';
  } else if (setting?.goal === 'maintain') {
    reason = 'maintain';
  } else if (top.reps >= high) {
    if (top.weightKg <= 0) {
      reps = Math.floor(top.reps) + 1;
      reason = 'moreReps';
    } else if (noIncrease) {
      reason = 'noIncrease';
    } else {
      weightKg = top.weightKg + step;
      reps = low;
      reason = 'up';
    }
  } else if (top.reps < low) {
    const before = counted[counted.indexOf(last) - 1];
    const beforeTop = before && leadSet(before);
    const twice = !!beforeTop && beforeTop.reps < low && beforeTop.weightKg >= top.weightKg;
    if (twice && top.weightKg > 0) {
      weightKg = stepsFrom(top.weightKg, top.weightKg - step, step);
      reason = 'down';
    } else {
      reps = low;
      reason = 'hold';
    }
  } else if (noIncrease) {
    reason = 'noIncrease';
  } else {
    reps = Math.floor(top.reps) + 1;
    reason = 'moreReps';
  }

  // Pain last time: the same numbers at most, whatever the rules above would add.
  if (latest.pain && (reason === 'up' || reason === 'moreReps' || reason === 'hold' || reason === 'noIncrease')) {
    weightKg = top.weightKg;
    reps = top.reps;
    reason = 'pain';
  }

  // A later slot explains fewer reps, and a good session from an earlier slot is no reason to push.
  if (slots > 0 && (reason === 'up' || reason === 'moreReps' || reason === 'hold')) {
    repDrop = Math.min(slots, MAX_LATER_DROP);
    weightKg = top.weightKg;
    reps = Math.max(1, top.reps - repDrop);
    reason = 'laterInWorkout';
  } else if (slots < 0 && (reason === 'up' || reason === 'moreReps')) {
    reason = 'earlierInWorkout';
  }

  const work = workPlan(last, top, weightKg, reps, step, repDrop, usualWorkSets(history));
  const warm = warmUps(last, weightKg, top.weightKg, step, exercise.compound, top.level);
  return { weightKg, reps, sets: [...warm, ...work], reason, params: { ...params, target: reps } };
}
