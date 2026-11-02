import { fmtNumber, t } from '../i18n.svelte';
import type { Load, Workout, WorkoutSet } from '../types';

/** Longer than this, the workout was most likely left open, so its time says nothing. */
const LONGEST_WORKOUT_MINUTES = 5 * 60;

/** Minutes from start to finish; null when that isn't known or can't be right. */
export function workoutMinutes(workout: Pick<Workout, 'startedAt' | 'finishedAt'>): number | null {
  const { startedAt, finishedAt } = workout;
  if (startedAt === undefined || finishedAt === undefined) return null;
  const minutes = Math.floor((finishedAt - startedAt) / 60000);
  return minutes >= 1 && minutes <= LONGEST_WORKOUT_MINUTES ? minutes : null;
}

/** 52 → "52 min", 72 → "1:12 h": short enough for a tile a third of a phone wide. */
export function fmtMinutes(minutes: number): string {
  if (minutes < 60) return t('workout.summary.minutes', { minutes });
  return t('workout.summary.hours', { time: fmtDuration(minutes) });
}

/** 100 → "1:40". */
export function fmtDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function withReps(weightKg: number, reps: string, load: Load): string {
  if (load === 'body') {
    return weightKg > 0 ? t('workout.addedReps', { weight: fmtNumber(weightKg), reps }) : t('workout.repsOnly', { reps });
  }
  return t('workout.weightReps', { weight: fmtNumber(weightKg), reps });
}

/** One set: "60 kg × 8", "+10 kg × 8", "× 12" or "1:40". */
export function fmtSet(set: Pick<WorkoutSet, 'weightKg' | 'reps' | 'seconds'>, load: Load): string {
  if (load === 'time') return fmtDuration(set.seconds ?? 0);
  return withReps(set.weightKg, fmtNumber(set.reps), load);
}

/** Work sets in a line, with sets at the same weight together: "60 kg × 8, 7 · 55 kg × 10". */
export function summarizeSets(sets: WorkoutSet[], load: Load): string {
  const work = sets.filter((s) => s.kind === 'work');
  const shown = work.length ? work : sets;
  if (load === 'time') return shown.map((s) => fmtDuration(s.seconds ?? 0)).join(', ');
  const groups: { weightKg: number; reps: number[] }[] = [];
  for (const set of shown) {
    const group = groups.at(-1);
    if (group?.weightKg === set.weightKg) group.reps.push(set.reps);
    else groups.push({ weightKg: set.weightKg, reps: [set.reps] });
  }
  return groups.map((g) => withReps(g.weightKg, g.reps.map(fmtNumber).join(', '), load)).join(' · ');
}
