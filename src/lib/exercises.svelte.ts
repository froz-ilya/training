import { CATALOG, catalogExercise, exerciseName } from './catalog/exercises';
import { db } from './db/schema';
import { i18n } from './i18n.svelte';
import { settings } from './settings.svelte';
import type { Exercise, Lang } from './types';

/** The language exercise names are shown in. */
export function nameLang(): Lang {
  return settings.exerciseLang === 'auto' ? i18n.lang : settings.exerciseLang;
}

export function nameOf(exercise: Exercise): string {
  return exerciseName(exercise, nameLang());
}

/** The catalogue plus the user's own exercises. */
export async function allExercises(): Promise<Exercise[]> {
  return [...CATALOG, ...(await db.customExercises.toArray())];
}

export async function getExercise(id: string): Promise<Exercise | undefined> {
  return catalogExercise(id) ?? db.customExercises.get(id);
}
