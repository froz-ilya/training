import { groupOf, type GroupWork, type MuscleGroup } from '../catalog/groups';
import { i18n, locale, t } from '../i18n.svelte';
import type { Exercise, Muscle, WorkoutSet } from '../types';

/**
 * A workout is named after what it trained, so its title follows the interface language. Nothing
 * is stored: this is worked out from its exercises whenever it's shown.
 */

/** One workout's exercises, as mainGroups() reads them. Exercises that no longer exist are left out. */
export function groupWork(sets: Pick<WorkoutSet, 'exerciseId' | 'entry' | 'kind'>[], exercises: Map<string, Exercise>): GroupWork[] {
  const work = new Map<number, GroupWork>();
  for (const set of sets) {
    const muscle = exercises.get(set.exerciseId)?.muscle;
    if (!muscle) continue;
    const entry = work.get(set.entry) ?? { muscle, sets: 0 };
    if (set.kind === 'work') entry.sets += 1;
    work.set(set.entry, entry);
  }
  return [...work.values()];
}

/** A list that reads as a name; German nouns keep their capitals. */
export function nameList(labels: string[]): string {
  const rest = labels.slice(1).map((label) => (i18n.lang === 'de' ? label : label.toLocaleLowerCase(locale())));
  return [labels[0], ...rest].join(', ');
}

/** "Chest, legs". "Workout" until there's an exercise. */
export function workoutTitle(groups: MuscleGroup[]): string {
  if (!groups.length) return t('workout.untitled');
  return nameList(groups.map((group) => t(`exercises.group.${group}`)));
}

/** "Back, biceps": a type with what's usually trained with it, which says more than "arms" would. */
export function typeTitle(groups: MuscleGroup[], partners: Muscle[]): string {
  const covered = new Set(partners.map(groupOf));
  const labels = groups.filter((group) => !covered.has(group)).map((group) => t(`exercises.group.${group}`));
  return nameList([...labels, ...partners.map((muscle) => t(`exercises.muscle.${muscle}`))]);
}
