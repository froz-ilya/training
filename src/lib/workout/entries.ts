import type { WorkoutSet } from '../types';

/** One exercise card in a workout: its sets, in order. */
export interface Entry {
  entry: number;
  exerciseId: string;
  sets: WorkoutSet[];
}

export function groupEntries(sets: WorkoutSet[]): Entry[] {
  const entries = new Map<number, Entry>();
  for (const set of [...sets].sort((a, b) => a.entry - b.entry || a.order - b.order)) {
    const entry = entries.get(set.entry) ?? { entry: set.entry, exerciseId: set.exerciseId, sets: [] };
    entry.sets.push(set);
    entries.set(set.entry, entry);
  }
  return [...entries.values()];
}

/** The first set not checked off, after `after` when given, wrapping round to the start. */
export function nextOpenSet(entries: Entry[], after?: string): WorkoutSet | undefined {
  const sets = entries.flatMap((e) => e.sets);
  const start = after ? sets.findIndex((s) => s.id === after) + 1 : 0;
  return [...sets.slice(start), ...sets.slice(0, start)].find((s) => !s.done && s.id !== after);
}
