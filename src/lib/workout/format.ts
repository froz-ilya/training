import { fmtNumber, t } from '../i18n.svelte';
import type { Load, WorkoutSet } from '../types';

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
