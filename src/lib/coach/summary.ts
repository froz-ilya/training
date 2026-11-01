import { fromISODate, toISODate } from '../dates';
import type { Load } from '../types';
import { IMPROVEMENT } from './status';
import { comparableSets, estimateSet, type Session, type SessionSet } from './strength';

export interface ExerciseRecords {
  heaviest: SessionSet | null;
  heaviestDate: string | null;
  bestEstimate: number;
  bestEstimateDate: string | null;
  mostReps: number;
  sessions: number;
}

export function exerciseRecords(sessions: Session[], load: Load, body: number): ExerciseRecords {
  const records: ExerciseRecords = {
    heaviest: null,
    heaviestDate: null,
    bestEstimate: 0,
    bestEstimateDate: null,
    mostReps: 0,
    sessions: sessions.length,
  };
  for (const session of sessions) {
    for (const set of comparableSets(session)) {
      const top = records.heaviest;
      if (!top || set.weightKg > top.weightKg || (set.weightKg === top.weightKg && set.reps > top.reps)) {
        records.heaviest = set;
        records.heaviestDate = session.date;
      }
      const estimate = estimateSet(set, load, body);
      if (estimate > records.bestEstimate) {
        records.bestEstimate = estimate;
        records.bestEstimateDate = session.date;
      }
      records.mostReps = Math.max(records.mostReps, set.reps);
    }
  }
  return records;
}

export interface NewBest {
  date: string;
  set: SessionSet;
  /** Improvement over the previous best, as a share. */
  gain: number;
}

/** The sessions that set a new best estimate, newest first. */
export function newBests(sessions: Session[], load: Load, body: number): NewBest[] {
  const bests: NewBest[] = [];
  let best = 0;
  for (const session of sessions) {
    let top: SessionSet | null = null;
    let value = 0;
    for (const set of comparableSets(session)) {
      const estimate = estimateSet(set, load, body);
      if (estimate > value) {
        value = estimate;
        top = set;
      }
    }
    if (top && best > 0 && value > best * IMPROVEMENT) bests.unshift({ date: session.date, set: top, gain: value / best - 1 });
    if (value > best) best = value;
  }
  return bests;
}

/** Monday of a date's week. */
export function weekStart(date: string): string {
  const day = fromISODate(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return toISODate(day);
}

export interface WeekVolume {
  week: string;
  sets: number;
}

/** Work sets per week for the last `weeks` weeks, oldest first; empty weeks included. */
export function weeklyVolume(entries: { date: string; workSets: number }[], today: string, weeks: number): WeekVolume[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const week = weekStart(entry.date);
    totals.set(week, (totals.get(week) ?? 0) + entry.workSets);
  }
  const list: WeekVolume[] = [];
  const cursor = fromISODate(weekStart(today));
  cursor.setDate(cursor.getDate() - (weeks - 1) * 7);
  for (let i = 0; i < weeks; i++) {
    const week = toISODate(cursor);
    list.push({ week, sets: totals.get(week) ?? 0 });
    cursor.setDate(cursor.getDate() + 7);
  }
  return list;
}

export interface CalendarDay {
  date: string;
  trained: boolean;
  future: boolean;
}

/** Whole weeks ending with the current one, Monday first: `weeks` columns of 7 days. */
export function calendarWeeks(trained: Set<string>, today: string, weeks: number): CalendarDay[][] {
  const columns: CalendarDay[][] = [];
  const cursor = fromISODate(weekStart(today));
  cursor.setDate(cursor.getDate() - (weeks - 1) * 7);
  for (let w = 0; w < weeks; w++) {
    const column: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = toISODate(cursor);
      column.push({ date, trained: trained.has(date), future: date > today });
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(column);
  }
  return columns;
}
