import { daysBetween } from '../dates';
import { median } from './position';
import { weekStart } from './summary';

/** How often someone trains, so a normal gap in their week is never read as a break. */

const WEEKS_LOOKED_AT = 8;
const DEFAULT_PER_WEEK = 3;
const DAYS_IN_WEEK = 7;

/** Workouts a week: the user's setting, else their usual week, else a common default. */
export function weeklyFrequency(workoutDates: string[], settingValue: number | undefined): number {
  if (settingValue && settingValue > 0) return Math.min(DAYS_IN_WEEK, Math.round(settingValue));
  const weeks = new Map<string, number>();
  for (const date of workoutDates) {
    const week = weekStart(date);
    weeks.set(week, (weeks.get(week) ?? 0) + 1);
  }
  if (!weeks.size) return DEFAULT_PER_WEEK;
  const recent = [...weeks.keys()].sort().slice(-WEEKS_LOOKED_AT);
  const usual = Math.round(median(recent.map((week) => weeks.get(week) as number)));
  return Math.max(1, Math.min(DAYS_IN_WEEK, usual));
}

/** Days until a rotation comes round again: 2 a week over 3 types is about every 10 days. */
export function expectedGapDays(perWeek: number, rotationTypes: number): number {
  return (DAYS_IN_WEEK * Math.max(1, rotationTypes)) / Math.max(1, perWeek);
}

export interface WeekProgress {
  done: number;
  total: number;
  /** Fewer workouts so far than the days gone by would suggest. */
  behind: boolean;
}

/** This week so far, from Monday. Today isn't counted as gone by: there's still time for it. */
export function weekProgress(workoutDates: string[], today: string, perWeek: number): WeekProgress {
  const monday = weekStart(today);
  const done = workoutDates.filter((date) => date >= monday && date <= today).length;
  const daysGone = daysBetween(monday, today);
  const paced = Math.floor((perWeek * daysGone) / DAYS_IN_WEEK);
  return { done, total: perWeek, behind: done < perWeek && done < paced };
}
