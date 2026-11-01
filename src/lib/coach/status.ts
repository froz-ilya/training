import { daysBetween } from '../dates';
import type { ExerciseGoal } from '../types';
import { beatsAcrossSets } from './compare';
import { adjustPoints, median } from './position';
import { typicalGap, type StrengthPoint } from './strength';

export type ExerciseState = 'new' | 'progressing' | 'holding' | 'stalled' | 'dropping' | 'returning';

export interface ExerciseStatus {
  state: ExerciseState;
  /** Best estimate in the compared period; 0 when there's none. */
  best: number;
  bestDate: string | null;
  /** Sessions and weeks since the latest progress: a new best, or a clear gain across the sets. */
  sessionsSinceBest: number;
  weeksSinceBest: number;
  daysSinceLast: number | null;
  /** Numbers fell sharply and stayed there: possibly a different machine, so ask. */
  maybeMachineChange: boolean;
  /** The latest progress was across the sets, with no new best estimate. */
  acrossSets?: boolean;
  /** Climbing clearly, with no new best yet: on the way back towards an older one. */
  buildingBack?: boolean;
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
/** Direction is read from this many days up to the latest session: the chart's shortest range. */
const TREND_DAYS = 183;
/** A move of this share is a direction: twice the 1% day-to-day band, so variation isn't one. */
const TREND_BAND = 0.02;
/** A climb has come this far from its low: about two reps, so one rep up isn't a climb. */
const RISE_BAND = 0.04;
/** Sessions looked back over for the low point a climb starts from. */
const TREND_SESSIONS = 6;
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

/** A gain across the sets is progress only while the top set holds: it's for a top set that ties. */
export const tiesBest = (point: StrengthPoint, best: number) => point.value * IMPROVEMENT >= best;

/** The session that did most across its sets, which later sessions have to beat. */
export function bestWork(points: StrengthPoint[]): StrengthPoint | undefined {
  let work: StrengthPoint | undefined;
  for (const point of points) if (!work || beatsAcrossSets(point, work)) work = point;
  return work;
}

/** Index of the latest session that made progress: a new best, or a clear gain across its sets. */
export function progressIndex(points: StrengthPoint[]): number {
  let best = points[0];
  let work = points[0];
  let index = 0;
  points.forEach((point, i) => {
    const newBest = point.value > best.value * IMPROVEMENT;
    const moreWork = tiesBest(point, best.value) && beatsAcrossSets(point, work);
    if (newBest) best = point;
    if (moreWork) work = point;
    if (newBest || moreWork) index = i;
  });
  return index;
}

/** An off-day session stays out of the comparison, unless it made progress anyway. */
export function countedPoints(points: StrengthPoint[]): StrengthPoint[] {
  let best = 0;
  let work: StrengthPoint | undefined;
  return points.filter((point) => {
    const moreWork = !!work && tiesBest(point, best) && beatsAcrossSets(point, work);
    if (point.offDay && point.value <= best * IMPROVEMENT && !moreWork) return false;
    best = Math.max(best, point.value);
    if (!work || moreWork) work = point;
    return true;
  });
}

export interface StatusOptions {
  today: string;
  goal?: ExerciseGoal;
  /** The user said the fall isn't a machine change. */
  ignoreFall?: boolean;
  /**
   * Strength lost per position later in a workout: doing an exercise later isn't a drop. A point's
   * `priorSets` count as well, so neither is a session after hard work for the same muscle.
   */
  positionCost?: number;
  /** Days a rotation normally takes at the user's weekly frequency. */
  expectedGapDays?: number;
  /** The latest machine or gym change, when there's history before it. */
  restartedOn?: string;
}

/**
 * Clearly climbing from the latest low, which three sessions can show. It takes two sessions clear
 * of the low, so one good day isn't a climb, and the latest low, so reps going up and down aren't
 * one either. The latest has to be further on than the first of them: a step up that then stays
 * flat has stopped climbing. Oldest value first.
 */
export function isRising(values: number[]): boolean {
  const stretch = values.slice(-TREND_SESSIONS);
  const low = Math.min(...stretch);
  const climb = stretch.slice(stretch.lastIndexOf(low) + 1);
  if (climb.length < 2) return false;
  const latest = climb[climb.length - 1];
  const second = [...climb].sort((a, b) => b - a)[1];
  return latest > low * (1 + RISE_BAND) && latest > climb[0] * (1 + TREND_BAND) && second > low * (1 + TREND_BAND);
}

/** The latest three clearly below the three before them. Oldest value first. */
export function isFalling(values: number[]): boolean {
  if (values.length < 4) return false;
  return median(values.slice(-3)) < median(values.slice(-6, -3)) * (1 - TREND_BAND);
}

/** Sessions a status needs before it can say anything. */
const MIN_POINTS = 3;

export function exerciseStatus(rawPoints: StrengthPoint[], options: StatusOptions): ExerciseStatus {
  const { today, goal, ignoreFall, positionCost, expectedGapDays = 0, restartedOn } = options;
  const adjusted = positionCost || rawPoints.some((p) => p.priorSets) ? adjustPoints(rawPoints, positionCost ?? 0) : rawPoints;
  const allPoints = countedPoints(adjusted);
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
  const progress = progressIndex(points);
  const sessionsSinceBest = points.length - 1 - progress;
  const weeksSinceBest = daysBetween(points[progress].date, last.date) / 7;
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
  // Being below an old peak isn't dropping: what counts is where the sessions on the chart are heading.
  // So it reads the numbers the chart draws, before any allowance for position.
  const drawn = new Map(adjusted.map((p, i) => [p, rawPoints[i].value]));
  const trend = points.filter((p) => daysBetween(p.date, last.date) <= TREND_DAYS).map((p) => drawn.get(p) ?? p.value);
  const rising = isRising(trend);
  if (!rising && sessionsSinceBest >= 3 && recent < best.value * DROP_RATIO && isFalling(trend)) {
    return after(goal === 'maintain' ? 'holding' : 'dropping');
  }
  if (!rising && sessionsSinceBest >= STALL_SESSIONS && weeksSinceBest >= STALL_WEEKS) {
    return after(goal === 'maintain' ? 'holding' : 'stalled');
  }
  if (progress > 0 && sessionsSinceBest <= 2) return { ...after('progressing'), ...(progress > index ? { acrossSets: true } : {}) };
  if (rising && goal !== 'maintain') return { ...after('progressing'), buildingBack: true };
  return after('holding');
}
