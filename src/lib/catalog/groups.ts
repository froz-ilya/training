import type { Exercise, Muscle } from '../types';
import { difficultyOf } from './difficulty';

/** The broad body parts that workout titles and the Progress tab go by. */
export type MuscleGroup = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core' | 'cardio' | 'fullBody';

export const MUSCLE_GROUPS: MuscleGroup[] = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'cardio', 'fullBody'];

const GROUP_OF: Record<Muscle, MuscleGroup> = {
  chest: 'chest',
  back: 'back',
  shoulders: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  legs: 'legs',
  glutes: 'legs',
  calves: 'legs',
  abs: 'core',
  cardio: 'cardio',
  fullBody: 'fullBody',
};

export function groupOf(muscle: Muscle): MuscleGroup {
  return GROUP_OF[muscle];
}

/** The groups a rotation type can be. Shoulders, arms and core round a day off rather than define it. */
export const ROTATION_GROUPS: readonly MuscleGroup[] = ['chest', 'back', 'legs'];

/** What reading a day's groups needs to know of an exercise. */
export type GroupExercise = Pick<Exercise, 'id' | 'muscle' | 'compound' | 'equipment'>;

/** Light work for chest, back or legs. On another of them's day it only rounds the day off. */
export function lightDayWork(exercise: GroupExercise): boolean {
  return difficultyOf(exercise) === 'light' && ROTATION_GROUPS.includes(groupOf(exercise.muscle));
}

/**
 * The work that says what a day was. Light work for chest, back or legs is left out when another of
 * them had medium or hard work: a leg curl on a chest day isn't a leg day. Focus brings in exactly
 * that, and it mustn't change the rotation or the title. Left out means its sets don't count at all,
 * so the day reads as it would without it. A day of only light work for them is read in full.
 */
export function dayWork<T extends { exercise: GroupExercise }>(work: T[]): T[] {
  const heavier = new Set(work.flatMap(({ exercise }) => (lightDayWork(exercise) || !ROTATION_GROUPS.includes(groupOf(exercise.muscle)) ? [] : [groupOf(exercise.muscle)])));
  if (!heavier.size) return work;
  return work.filter(({ exercise }) => !lightDayWork(exercise) || heavier.has(groupOf(exercise.muscle)));
}

/** Groups a workout is usually built around; arms and core mostly finish one off. */
const LARGE: readonly MuscleGroup[] = ['chest', 'back', 'legs', 'shoulders'];
/** Share of a workout's sets a group needs to be named. */
const LARGE_SHARE = 0.2;
const SMALL_SHARE = 0.5;
const MAX_GROUPS = 3;

export interface GroupWork {
  exercise: GroupExercise;
  /** Work sets; an exercise with none yet still counts as one. */
  sets: number;
}

const groupOrder = (group: MuscleGroup) => MUSCLE_GROUPS.indexOf(group);

/** The groups worth naming, most sets first; equal sets go by the fixed order of groups. */
function rankedGroups(exercises: GroupWork[]): MuscleGroup[] {
  const totals = new Map<MuscleGroup, number>();
  for (const { exercise, sets } of dayWork(exercises)) {
    const group = groupOf(exercise.muscle);
    totals.set(group, (totals.get(group) ?? 0) + Math.max(1, sets));
  }
  const ranked = [...totals].sort((a, b) => b[1] - a[1] || groupOrder(a[0]) - groupOrder(b[0]));
  const all = ranked.reduce((sum, [, sets]) => sum + sets, 0);
  const named = ranked.filter(([group, sets]) => sets / all >= (LARGE.includes(group) ? LARGE_SHARE : SMALL_SHARE));
  return (named.length ? named : ranked.slice(0, 1)).slice(0, MAX_GROUPS).map(([group]) => group);
}

/**
 * What a workout trained: at most three groups. One triceps exercise after a chest day doesn't make
 * it an arms day, and a leg curl on a chest day doesn't make it a leg day (dayWork()). They're listed in the fixed order of groups, so a split keeps one name however its
 * sets fall on the day. Empty for a workout with no known exercises.
 */
export function mainGroups(exercises: GroupWork[]): MuscleGroup[] {
  return rankedGroups(exercises).sort((a, b) => groupOrder(a) - groupOrder(b));
}

/** The named group with the most sets, which is what the rotation goes by. */
export function leadingGroup(exercises: GroupWork[]): MuscleGroup | undefined {
  return rankedGroups(exercises)[0];
}
