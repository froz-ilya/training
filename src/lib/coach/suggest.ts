import { daysBetween } from '../dates';
import type { Exercise, ExerciseSettings, Load, Muscle, SetKind } from '../types';
import type { ExerciseStatus } from './status';
import { DEFAULT_POSITION_COST, expectedLoss, median } from './position';
import {
  bodyKg,
  countedSessions,
  doneWork,
  leadSet,
  repRange,
  topSet,
  typicalGap,
  weightStep,
  type PriorWork,
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
  /** Added by Focus on top of the usual sets. */
  extra?: boolean;
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
  | 'climbBack'
  | 'maintain'
  | 'noIncrease'
  | 'lighterWeek'
  | 'pain'
  | 'laterInWorkout'
  | 'earlierInWorkout'
  | 'earlierWork';

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
    /** The muscle with more earlier work today, for the 'earlierWork' reason. */
    muscle?: Muscle;
    /** The muscle other exercises kept working during a break, which made the cut smaller. */
    keptMuscle?: Muscle;
    /** The numbers from before a break, for the 'climbBack' reason. */
    before?: { weightKg: number; reps: number };
    /** A long break takes one work set off the first session back. */
    fewerSets?: boolean;
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
  /** Earlier work in today's planned order. */
  priorWork?: PriorWork | null;
  /** Strength lost per position later in a workout. */
  positionCost?: number;
  /** Days a rotation normally takes at the user's weekly frequency. */
  expectedGapDays?: number;
  /** The last day other exercises worked this muscle, when they kept it trained during a break. */
  keptUntil?: string;
  /** Used to compare bodyweight sets. */
  body?: number;
}

interface BreakTier {
  days: number;
  /** A break also has to be this many times the exercise's usual gap. */
  gaps: number;
  /** What's kept of the last numbers. At 1 they stay, without an increase. */
  share: number;
}

/** Below this, an exercise hasn't been away for long enough to count as any kind of break. */
export const BREAK_MIN_DAYS = 10;
const SHORT_BREAK: BreakTier = { days: 14, gaps: 1.5, share: 0.95 };
/** Starting values, longest first: strength holds for a couple of weeks, then fades slowly. */
const BREAKS: BreakTier[] = [
  { days: 180, gaps: 8, share: 0.75 },
  { days: 60, gaps: 4, share: 0.85 },
  { days: 21, gaps: 2.25, share: 0.9 },
  SHORT_BREAK,
  { days: BREAK_MIN_DAYS, gaps: 1.5, share: 1 },
];
/** The part of the cut that stays when other exercises kept the muscle working: the movement is still out of practice. */
const KEPT_CUT = 0.5;
/** A cut this big or bigger takes a set off the first session back, because soreness comes from volume too. */
const FEWER_SETS_SHARE = 0.85;
/** Sessions after a break that can still be climbing back to the numbers from before it. */
const CLIMB_SESSIONS = 16;
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
/**
 * How much more today's order must be expected to cost than the base session's before the target
 * stops rising: twice the 1% day-to-day band, so comparable fatigue leaves the usual increases alone.
 */
const FATIGUE_HOLD = 0.02;
/** And before the target gives up a rep: about two reps' worth in a set of 10, of which it takes one. */
const FATIGUE_DROP = 0.05;
const DEFAULT_WORK_SETS = 3;
/** Sessions the usual number of work sets comes from. */
export const USUAL_SETS_SESSIONS = 6;

const breakLength = (tier: BreakTier, gap: number) => Math.max(tier.days, tier.gaps * gap);

/** What's kept of the last numbers after `days` away, or null when that's no break. */
function breakShare(days: number, gap: number): number | null {
  return BREAKS.find((tier) => days >= breakLength(tier, gap))?.share ?? null;
}

/** The muscle's own rest counts in full; the rest of the exercise's break counts for part of its cut. */
function keptShare(share: number, restDays: number, gap: number): number {
  return Math.min(breakShare(restDays, gap) ?? 1, 1 - (1 - share) * KEPT_CUT);
}

/** The lead set from before the latest break, until a session since then has got back to its weight. */
function beforeBreak(history: Session[], counted: Session[], breakDays: number): SessionSet | null {
  const oldest = Math.max(1, history.length - CLIMB_SESSIONS);
  for (let i = history.length - 1; i >= oldest; i--) {
    const returned = history[i].date;
    if (daysBetween(history[i - 1].date, returned) < breakDays) continue;
    const earlier = counted.filter((s) => s.date < returned);
    const before = earlier.length ? leadSet(earlier[earlier.length - 1]) : null;
    const reached = before && counted.some((s) => s.date >= returned && (leadSet(s)?.weightKg ?? 0) >= before.weightKg);
    return reached ? null : before;
  }
  return null;
}

/** Reasons that ask for more than last time, which pain or a later slot then hold back. */
const asksForMore = (reason: ReasonCode) => reason === 'up' || reason === 'moreReps' || reason === 'hold' || reason === 'climbBack';

/** A plan stays at the height the set was done at, and adds nothing when it has none. */
const atLevel = (level: number | undefined) => (level === undefined ? {} : { level });

/** How many work sets this user usually does for this exercise. Sets Focus added don't count. */
export function usualWorkSets(history: Session[]): number {
  const counts = history.slice(-USUAL_SETS_SESSIONS).map((s) => doneWork(s).filter((set) => !set.extra).length).filter(Boolean);
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
  if (share >= 1) return { weightKg: top.weightKg, reps: top.reps, repDrop: 0 };
  const weightKg = stepsFrom(top.weightKg, top.weightKg * share, step);
  if (weightKg < top.weightKg) return { weightKg, reps: top.reps, repDrop: 0 };
  const repDrop = Math.max(1, Math.round(top.reps * (1 - share)));
  const reps = Math.min(top.reps, Math.max(1, Math.ceil(top.reps) - repDrop));
  return { weightKg: top.weightKg, reps, repDrop: reps < top.reps ? repDrop : 0 };
}

/** About `share` of a duration, at least one time step shorter; unchanged when that leaves nothing. */
function easedSeconds(seconds: number, share: number): number {
  if (share >= 1) return seconds;
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
  // Focus's extras go by its own plan, so the usual sets are planned from the usual ones.
  const sets = doneWork(last).filter((set) => !set.extra || set === lead);
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
  const done = doneWork(last).filter((set) => !set.extra || set === top);
  const dropped = params.fewerSets ? [...done].reverse().find((set) => set !== top) : undefined;
  const sets = done.filter((set) => set !== dropped).map((set) => ({
    kind: 'work' as const,
    weightKg: set.weightKg,
    reps: 0,
    seconds: set === top || (shorter && (set.seconds ?? 0) > seconds) ? seconds : set.seconds,
    ...carried(set),
  }));
  return { weightKg: top.weightKg, reps: 0, seconds, sets, reason, params: { ...params, fewerSets: !!dropped } };
}

/**
 * What to do today, from the sessions since the latest baseline. Null with no history: there's
 * nothing to go on, and a guessed weight for someone's first session wouldn't be safe.
 */
export function suggestSets(exercise: Exercise, history: Session[], options: SuggestOptions): Suggestion | null {
  const { today, setting, status, lighterWeek, position, priorWork, positionCost = DEFAULT_POSITION_COST, expectedGapDays = 0, keptUntil, body } = options;
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
  /** What today's order is expected to cost beyond the session this builds on, rounded so limits hold exactly. */
  const extraLoss =
    position === undefined || !priorWork
      ? 0
      : Math.round((expectedLoss(position, positionCost, priorWork.sets) - expectedLoss(last.position, positionCost, last.priorWork?.sets)) * 1000) / 1000;
  const moreWork = extraLoss >= FATIGUE_HOLD;
  const step = weightStep(exercise, history, setting);
  const lastSeconds = top.seconds ?? 0;
  const baseDate = last === latest ? undefined : last.date;
  const gap = Math.max(typicalGap(history.map((s) => s.date)), expectedGapDays);
  const ownShare = breakShare(days, gap);
  const share = ownShare !== null && keptUntil ? keptShare(ownShare, daysBetween(keptUntil, today), gap) : ownShare;
  const keptMuscle = share !== null && ownShare !== null && share > ownShare ? exercise.muscle : undefined;
  const fewerSets = !lighterWeek && share !== null && share <= FEWER_SETS_SHARE;
  const base = { weightKg: top.weightKg, reps: top.reps, seconds: lastSeconds, target: top.reps, low, high, days, load: exercise.load, baseDate };
  const params = share === null || lighterWeek ? base : { ...base, keptMuscle };

  if (exercise.load === 'time') {
    if (lighterWeek) return timedSuggestion(last, top, 'lighterWeek', { ...params, target: easedSeconds(lastSeconds, LIGHTER_WEEK) });
    if (share !== null) {
      const target = easedSeconds(lastSeconds, share);
      return timedSuggestion(last, top, target < lastSeconds ? 'afterBreakTime' : 'afterBreakSame', { ...params, target, fewerSets });
    }
    const hold = setting?.goal === 'maintain';
    if (hold || latest.pain || slots > 0) {
      const reason = hold ? 'maintain' : latest.pain ? 'pain' : 'laterInWorkout';
      return timedSuggestion(last, top, reason, { ...params, target: lastSeconds });
    }
    if (moreWork) return timedSuggestion(last, top, 'earlierWork', { ...params, target: lastSeconds, muscle: priorWork?.muscle });
    return timedSuggestion(last, top, 'moreTime', { ...params, target: lastSeconds + TIME_STEP_SECONDS });
  }

  const noIncrease = status?.state === 'stalled' || status?.state === 'dropping';
  const before = beforeBreak(history, counted, breakLength(SHORT_BREAK, gap));
  let weightKg = top.weightKg;
  let reps = top.reps;
  let repDrop = 0;
  let reason: ReasonCode;

  if (lighterWeek) {
    ({ weightKg, reps, repDrop } = eased(top, LIGHTER_WEEK, step));
    reason = 'lighterWeek';
  } else if (share !== null) {
    ({ weightKg, reps, repDrop } = eased(top, share, step));
    reason = weightKg < top.weightKg ? 'afterBreak' : reps < top.reps ? 'afterBreakReps' : 'afterBreakSame';
  } else if (before && top.weightKg < before.weightKg && top.reps >= before.reps) {
    // Lost strength comes back faster than it was built: straight back up, a step a session, at the old reps.
    weightKg = Math.min(top.weightKg + step, before.weightKg);
    reps = before.reps;
    reason = 'climbBack';
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
  if (latest.pain && (asksForMore(reason) || reason === 'noIncrease')) {
    weightKg = top.weightKg;
    reps = top.reps;
    reason = 'pain';
  }

  // A later slot explains fewer reps, and a good session from an earlier slot is no reason to push.
  if (slots > 0 && asksForMore(reason)) {
    repDrop = Math.min(slots, MAX_LATER_DROP);
    weightKg = top.weightKg;
    reps = Math.max(1, top.reps - repDrop);
    reason = 'laterInWorkout';
  } else if (moreWork && asksForMore(reason)) {
    // Never on top of the later slot above, and never a lighter weight: the same numbers, at most a rep fewer.
    repDrop = extraLoss >= FATIGUE_DROP ? 1 : 0;
    weightKg = top.weightKg;
    reps = Math.max(1, top.reps - repDrop);
    reason = 'earlierWork';
  } else if (slots < 0 && extraLoss <= 0 && (reason === 'up' || reason === 'moreReps')) {
    reason = 'earlierInWorkout';
  }

  const usual = usualWorkSets(history);
  const work = workPlan(last, top, weightKg, reps, step, repDrop, fewerSets ? Math.max(1, usual - 1) : usual);
  const warm = warmUps(last, weightKg, top.weightKg, step, exercise.compound, top.level);
  const muscle = reason === 'earlierWork' ? { muscle: priorWork?.muscle } : {};
  const climbing = reason === 'climbBack' && before ? { before: { weightKg: before.weightKg, reps: before.reps } } : {};
  return { weightKg, reps, sets: [...warm, ...work], reason, params: { ...params, target: reps, ...muscle, ...climbing, fewerSets: work.length < usual } };
}
