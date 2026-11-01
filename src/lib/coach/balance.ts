import { BODY_REGIONS, regionsOf } from '../catalog/regions';
import { daysBetween } from '../dates';
import type { BodyRegion, Exercise, RegionGoal } from '../types';
import { HELPER_WEIGHT } from './fatigue';

/**
 * How much each part of the body gets trained, held against a general range. It says what the
 * training looks like, not how the muscles look or how strong they are. Worked out from history each
 * time and never stored, so the ranges can change with no migration.
 */

/** Weeks the average covers, counted back from today. */
const RECENT_WEEKS = 4;
/** With fewer weeks that have a workout, one heavy or light session would set the whole picture. */
const MIN_WEEKS = 2;
const DAYS_IN_WEEK = 7;

export interface SetRange {
  low: number;
  high: number;
}

/**
 * Hard sets a week. Starting values, from the ranges usually given for building muscle: `low` is about
 * where that work starts to be enough, so a modest plan of three workouts a week can reach it, and
 * `high` is about where more stops being of much use. Regions that get plenty from other exercises
 * need less of their own. These are a general guide that suits any user: a goal moves them.
 */
const RANGES: Record<BodyRegion, SetRange> = {
  chest: { low: 8, high: 20 },
  frontDelts: { low: 2, high: 12 },
  sideDelts: { low: 6, high: 20 },
  rearDelts: { low: 4, high: 16 },
  upperBack: { low: 4, high: 16 },
  lats: { low: 8, high: 20 },
  lowerBack: { low: 2, high: 10 },
  biceps: { low: 6, high: 20 },
  triceps: { low: 6, high: 18 },
  forearms: { low: 2, high: 12 },
  abs: { low: 4, high: 16 },
  glutes: { low: 4, high: 16 },
  quads: { low: 8, high: 20 },
  hamstrings: { low: 6, high: 16 },
  calves: { low: 4, high: 16 },
};

/** A focus region asks for more and has more room above it, so extra work on purpose reads as normal. */
const FOCUS_SCALE = 1.5;
/** Holding a muscle takes far less than building it. */
const MAINTAIN_LOW_SCALE = 1 / 3;
const MAINTAIN_HIGH_SCALE = 1 / 2;

export function regionRange(region: BodyRegion, goal?: RegionGoal): SetRange {
  const { low, high } = RANGES[region];
  if (goal === 'focus') return { low: Math.round(low * FOCUS_SCALE), high: Math.round(high * FOCUS_SCALE) };
  if (goal === 'maintain') return { low: Math.ceil(low * MAINTAIN_LOW_SCALE), high: Math.ceil(high * MAINTAIN_HIGH_SCALE) };
  return { low, high };
}

/** One exercise's part in a region over the recent weeks. */
export interface RegionShare {
  exercise: Exercise;
  /** Work sets, as logged. */
  sets: number;
  /** The region only helps here, so each set counts for part of one. */
  helper: boolean;
}

export interface RegionLoad {
  region: BodyRegion;
  /** Work sets in a week with workouts, whole so it never disagrees with the number shown. */
  perWeek: number;
  /** Biggest part first. */
  shares: RegionShare[];
}

export interface BodyLoad {
  /** Recent weeks with a workout; the weeks without one don't lower the average. */
  weeks: number;
  regions: RegionLoad[];
}

const shareWeight = (share: RegionShare) => share.sets * (share.helper ? HELPER_WEIGHT : 1);

/** Sets the regions got per week. Weeks run back from today, so the latest week is always a whole one. */
export function bodyLoad(work: { date: string; exerciseId: string }[], workoutDates: string[], exercises: Map<string, Exercise>, today: string): BodyLoad {
  const weekOf = (date: string) => Math.floor(daysBetween(date, today) / DAYS_IN_WEEK);
  const isRecent = (date: string) => daysBetween(date, today) >= 0 && weekOf(date) < RECENT_WEEKS;
  const weeks = new Set(workoutDates.filter(isRecent).map(weekOf)).size;
  const shares = new Map<BodyRegion, Map<string, RegionShare>>(BODY_REGIONS.map((region) => [region, new Map()]));
  for (const { date, exerciseId } of work) {
    const exercise = exercises.get(exerciseId);
    if (!exercise || !isRecent(date)) continue;
    const { main, helpers } = regionsOf(exercise);
    for (const [regions, helper] of [[main, false], [helpers, true]] as const) {
      for (const region of regions) {
        const own = shares.get(region)!;
        const share = own.get(exerciseId) ?? { exercise, sets: 0, helper };
        share.sets++;
        own.set(exerciseId, share);
      }
    }
  }
  return {
    weeks,
    regions: BODY_REGIONS.map((region) => {
      const list = [...shares.get(region)!.values()].sort((a, b) => shareWeight(b) - shareWeight(a));
      const total = list.reduce((sum, share) => sum + shareWeight(share), 0);
      return { region, perWeek: weeks ? Math.round(total / weeks) : 0, shares: list };
    }),
  };
}

/**
 * The last day other exercises worked what `target` trains, when they did enough since `from` to keep
 * it trained: what the range calls holding a muscle, per week of that time. A helper counts for part
 * of a set, as it does on the map.
 */
export function keptTrainingUntil(
  target: Pick<Exercise, 'id' | 'muscle' | 'helpers'>,
  work: { date: string; exerciseId: string }[],
  from: string,
  today: string,
  exercises: Map<string, Exercise>,
): string | undefined {
  const { main } = regionsOf(target);
  const days = daysBetween(from, today);
  if (!main.length || days <= 0) return undefined;
  const hits = (regions: BodyRegion[]) => regions.some((region) => main.includes(region));
  let sets = 0;
  let latest: string | undefined;
  for (const { date, exerciseId } of work) {
    const exercise = exercises.get(exerciseId);
    if (!exercise || exerciseId === target.id || date <= from || date > today) continue;
    const regions = regionsOf(exercise);
    const weight = hits(regions.main) ? 1 : hits(regions.helpers) ? HELPER_WEIGHT : 0;
    if (!weight) continue;
    sets += weight;
    if (!latest || date > latest) latest = date;
  }
  const needed = Math.max(...main.map((region) => regionRange(region, 'maintain').low));
  return (sets * DAYS_IN_WEEK) / days >= needed ? latest : undefined;
}

export function hasEnoughHistory(load: BodyLoad): boolean {
  return load.weeks >= MIN_WEEKS;
}

export type RegionStatus = 'less' | 'normal' | 'more' | 'ignored';

export function regionStatus({ region, perWeek }: Pick<RegionLoad, 'region' | 'perWeek'>, goal?: RegionGoal): RegionStatus {
  if (goal === 'ignore') return 'ignored';
  const { low, high } = regionRange(region, goal);
  if (perWeek < low) return 'less';
  return perWeek > high ? 'more' : 'normal';
}
