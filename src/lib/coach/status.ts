import { daysBetween } from '../dates';
import type { ExerciseGoal } from '../types';
import { adjustPoints, median } from './position';
import { typicalGap, type StrengthPoint } from './strength';

export type ExerciseState = 'new' | 'progressing' | 'holding' | 'stalled' | 'dropping' | 'returning';

export interface ExerciseStatus {
  state: ExerciseState;
  /** Best estimate in the compared period; 0 when there's none. */
  best: number;
  bestDate: string | null;
  sessionsSinceBest: number;
  weeksSinceBest: number;
  daysSinceLast: number | null;
  /** Numbers fell sharply and stayed there: possibly a different machine, so ask. */
  maybeMachineChange: boolean;
  /** The comparison restarted on this date, with too few sessions since to say anything yet. */
  restartedOn?: string;
}

/** A new best has to beat the old one by this much to count as real improvement. */
export const IMPROVEMENT = 1.01;
const STALL_SESSIONS = 4;
const STALL_WEEKS = 6;
const RETURN_DAYS = 21;
/** A break is also this many times the exercise's usual gap, so rotated exercises don't count. */
const RETURN_GAPS = 2;
const SESSIONS_AFTER_RETURN = 2;
/** Back at this share of the best: the comeback is over, whatever the sessions count says. */
const RECOVERED_RATIO = 0.97;
/** A status looks at this many days: a best from years ago says little about now. Records keep it. */
const COMPARE_DAYS = 365;
const DROP_RATIO = 0.9;
/** Every session after the fall sits at least this far below the sessions before it. */
const FALL_RATIO = 0.8;
const FALL_MIN_AFTER = 2;

/** Index of the first session after a sudden lasting fall, or -1. */
export function findFall(points: StrengthPoint[]): number {
  for (let i = 3; i <= points.length - FALL_MIN_AFTER; i++) {
    const before = median(points.slice(i - 3, i).map((p) => p.value));
    if (points.slice(i).every((p) => p.value <= before * FALL_RATIO)) return i;
  }
  return -1;
}

/** Running best, counting only real improvements. */
export function bestIndex(points: StrengthPoint[]): number {
  let index = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].value > points[index].value * IMPROVEMENT) index = i;
  }
  return index;
}

/** An off-day session stays out of the comparison, unless it set a new best. */
export function countedPoints(points: StrengthPoint[]): StrengthPoint[] {
  let best = 0;
  return points.filter((point) => {
    if (point.offDay && point.value <= best * IMPROVEMENT) return false;
    best = Math.max(best, point.value);
    return true;
  });
}

export interface StatusOptions {
  today: string;
  goal?: ExerciseGoal;
  /** The user said the fall isn't a machine change. */
  ignoreFall?: boolean;
  /** Strength lost per position later in a workout: doing an exercise later isn't a drop. */
  positionCost?: number;
  /** Days a rotation normally takes at the user's weekly frequency. */
  expectedGapDays?: number;
  /** The latest machine or gym change, when there's history before it. */
  restartedOn?: string;
}

/** Sessions a status needs before it can say anything. */
const MIN_POINTS = 3;

export function exerciseStatus(rawPoints: StrengthPoint[], options: StatusOptions): ExerciseStatus {
  const { today, goal, ignoreFall, positionCost, expectedGapDays = 0, restartedOn } = options;
  const allPoints = countedPoints(positionCost ? adjustPoints(rawPoints, positionCost) : rawPoints);
  const fall = ignoreFall ? -1 : findFall(allPoints);
  const maybeMachineChange = fall >= 0;
  // Until the user answers, the sessions before a possible machine change aren't compared.
  const comparable = maybeMachineChange ? allPoints.slice(fall) : allPoints;
  const recentPoints = comparable.filter((p) => daysBetween(p.date, today) <= COMPARE_DAYS);
  const points = recentPoints.length >= MIN_POINTS ? recentPoints : comparable;
  // Someone with history before a change isn't new. Sessions before it stay out of the comparison.
  const restarted = restartedOn && points.length < MIN_POINTS ? { restartedOn } : {};
  const early: ExerciseState = restartedOn ? 'returning' : 'new';
  const empty = { best: 0, bestDate: null, sessionsSinceBest: 0, weeksSinceBest: 0, daysSinceLast: null, maybeMachineChange, ...restarted };
  if (!points.length) return { state: early, ...empty };

  const index = bestIndex(points);
  const best = points[index];
  const last = points[points.length - 1];
  const sessionsSinceBest = points.length - 1 - index;
  const weeksSinceBest = daysBetween(best.date, last.date) / 7;
  // An off day is still a day in the gym, so it counts here even though it isn't compared.
  const daysSinceLast = daysBetween(rawPoints[rawPoints.length - 1].date, today);
  const base = { best: best.value, bestDate: best.date, sessionsSinceBest, weeksSinceBest, daysSinceLast, maybeMachineChange, ...restarted };

  const after = (state: ExerciseState): ExerciseStatus => ({ state, ...base });
  const usualGap = Math.max(typicalGap(points.map((p) => p.date)), expectedGapDays);
  const breakDays = Math.max(RETURN_DAYS, RETURN_GAPS * usualGap);
  if (daysSinceLast >= breakDays) return after('returning');
  if (last.value < best.value * RECOVERED_RATIO) {
    for (let i = Math.max(1, points.length - SESSIONS_AFTER_RETURN); i < points.length; i++) {
      if (daysBetween(points[i - 1].date, points[i].date) >= breakDays) return after('returning');
    }
  }
  if (allPoints.length < MIN_POINTS || points.length < MIN_POINTS) return after(early);

  // The median of the last three, so one bad day changes nothing.
  const recent = median(points.slice(-3).map((p) => p.value));
  if (sessionsSinceBest >= 3 && recent < best.value * DROP_RATIO) return after(goal === 'maintain' ? 'holding' : 'dropping');
  if (sessionsSinceBest >= STALL_SESSIONS && weeksSinceBest >= STALL_WEEKS) {
    return after(goal === 'maintain' ? 'holding' : 'stalled');
  }
  return after(index > 0 && sessionsSinceBest <= 2 ? 'progressing' : 'holding');
}
