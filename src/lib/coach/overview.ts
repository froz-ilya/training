import { groupOf, MUSCLE_GROUPS, type MuscleGroup } from '../catalog/groups';
import { daysBetween } from '../dates';
import type { Exercise, Load } from '../types';
import { median } from './position';
import type { ExerciseStatus } from './status';
import { isMeasured, workSets, type Session, type SessionSet, type StrengthPoint } from './strength';
import { weeklyVolume, type WeekVolume } from './summary';

/** What the Progress tab shows at a glance. Worked out from history each time, never stored. */

/** The summary and the bars cover this many weeks. */
const RECENT_WEEKS = 4;
/** Exercises can be trained about once a month, so strength is compared over a longer stretch. */
const TREND_WEEKS = 12;
/** Weeks in a group's chart. */
const CHART_WEEKS = 12;
/** A change smaller than this, either way, is ordinary variation. */
const FLAT_CHANGE = 0.01;
/** Not trained for this long: out of the way, under its own heading. */
const OLDER_DAYS = 90;

export interface Count {
  current: number;
  /** The same number of weeks just before. */
  previous: number;
}

export interface Overview {
  workouts: Count;
  sets: Count;
  bests: Count;
}

/** Adds up `count` for the recent weeks and for the same stretch before them. */
export function countRecent(entries: { date: string; count?: number }[], today: string): Count {
  const days = RECENT_WEEKS * 7;
  const total: Count = { current: 0, previous: 0 };
  for (const { date, count = 1 } of entries) {
    const age = daysBetween(date, today);
    if (age < 0 || age >= days * 2) continue;
    total[age < days ? 'current' : 'previous'] += count;
  }
  return total;
}

function bestIn(points: StrengthPoint[], today: string, fromAge: number, toAge: number): number {
  const values = points.flatMap((p) => {
    const age = daysBetween(p.date, today);
    return age >= fromAge && age < toAge ? [p.value] : [];
  });
  return values.length ? Math.max(...values) : 0;
}

/**
 * Best estimate of the latest weeks against the same stretch before them, as a share. Taking the
 * best means an off day can't lower it and a new best still counts. Null without both stretches.
 */
export function strengthChange(points: StrengthPoint[], today: string): number | null {
  const days = TREND_WEEKS * 7;
  const recent = bestIn(points, today, 0, days);
  const earlier = bestIn(points, today, days, days * 2);
  return recent > 0 && earlier > 0 ? recent / earlier - 1 : null;
}

export type TrendDirection = 'up' | 'down' | 'flat';

export function trendDirection(change: number): TrendDirection {
  if (Math.abs(change) < FLAT_CHANGE) return 'flat';
  return change > 0 ? 'up' : 'down';
}

export interface GroupSummary {
  group: MuscleGroup;
  lastDate: string;
  /** Work sets in the recent weeks. */
  recentSets: number;
  /** Work sets per week, for its chart. */
  weeks: WeekVolume[];
  /** Typical strength change of its exercises; null when none can be compared. */
  trend: number | null;
  /** Exercises behind `trend`. */
  compared: number;
}

interface GroupView {
  exercise: Pick<Exercise, 'muscle'>;
  sessions: Pick<Session, 'date'>[];
  points: StrengthPoint[];
}

/** One row per group with history, in the usual order of groups. */
export function groupSummaries(views: GroupView[], work: { date: string; group: MuscleGroup }[], today: string): GroupSummary[] {
  const summaries: GroupSummary[] = [];
  for (const group of MUSCLE_GROUPS) {
    const own = views.filter((v) => groupOf(v.exercise.muscle) === group && v.sessions.length);
    if (!own.length) continue;
    const dates = work.filter((w) => w.group === group).map((w) => ({ date: w.date, workSets: 1 }));
    const changes = own.flatMap((v) => {
      const change = strengthChange(v.points, today);
      return change === null ? [] : [change];
    });
    summaries.push({
      group,
      lastDate: own.map((v) => v.sessions[v.sessions.length - 1].date).reduce((a, b) => (a > b ? a : b)),
      recentSets: countRecent(dates, today).current,
      weeks: weeklyVolume(dates, today, CHART_WEEKS),
      trend: changes.length ? median(changes) : null,
      compared: changes.length,
    });
  }
  return summaries;
}

export type StatusHeading = 'attention' | 'going' | 'steady' | 'getting' | 'older';

export interface StatusList<T> {
  heading: StatusHeading;
  items: T[];
}

type StatusView = { status: ExerciseStatus; sessions: Pick<Session, 'date'>[] };

/** Exercises under their status headings; a heading with nothing under it is left out. */
export function statusLists<T extends StatusView>(views: T[], today: string): StatusList<T>[] {
  const lastDate = (v: T) => v.sessions[v.sessions.length - 1].date;
  const latestFirst = (a: T, b: T) => lastDate(b).localeCompare(lastDate(a));
  const active = views.filter((v) => daysBetween(lastDate(v), today) <= OLDER_DAYS);
  const older = views.filter((v) => daysBetween(lastDate(v), today) > OLDER_DAYS);
  const is = (...states: string[]) => (v: T) => !v.status.maybeMachineChange && states.includes(v.status.state);
  const lists: StatusList<T>[] = [
    {
      heading: 'attention',
      items: active
        .filter((v) => v.status.maybeMachineChange || is('stalled', 'dropping')(v))
        .sort((a, b) => b.status.weeksSinceBest - a.status.weeksSinceBest),
    },
    { heading: 'going', items: active.filter(is('progressing')).sort(latestFirst) },
    { heading: 'steady', items: active.filter(is('holding', 'returning')).sort(latestFirst) },
    { heading: 'getting', items: active.filter(is('new')).sort(latestFirst) },
    { heading: 'older', items: older.sort(latestFirst) },
  ];
  return lists.filter((list) => list.items.length);
}

export interface SessionCell {
  set: SessionSet;
  /** The part of the set that beat the same set of the session before. */
  better: 'weight' | 'reps' | 'time' | null;
}

export const isTimed = (set: Pick<SessionSet, 'reps' | 'seconds'>, load: Load) => load === 'time' || Boolean(set.seconds && !set.reps);

function betterPart(set: SessionSet, before: SessionSet | undefined, load: Load): SessionCell['better'] {
  // Numbers from different levels don't compare: a level changes how hard the same reps are.
  if (!before || set.level !== before.level || !isMeasured(set) || !isMeasured(before)) return null;
  if (isTimed(set, load)) return (set.seconds ?? 0) > (before.seconds ?? 0) ? 'time' : null;
  if (set.weightKg > before.weightKg) return 'weight';
  return set.weightKg === before.weightKg && set.reps > before.reps ? 'reps' : null;
}

/** A session's work sets, each held against the set in the same place the session before. */
export function sessionCells(session: Session, before: Session | undefined, load: Load): SessionCell[] {
  const earlier = before ? before.sets.filter((s) => s.kind === 'work') : [];
  return workSets(session).map((set, i) => ({ set, better: set.kind === 'work' ? betterPart(set, earlier[i], load) : null }));
}
