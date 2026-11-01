import type { Muscle } from '../types';

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

/** Groups a workout is usually built around; arms and core mostly finish one off. */
const LARGE: readonly MuscleGroup[] = ['chest', 'back', 'legs', 'shoulders'];
/** Share of a workout's sets a group needs to be named. */
const LARGE_SHARE = 0.2;
const SMALL_SHARE = 0.5;
const MAX_GROUPS = 3;

export interface GroupWork {
  muscle: Muscle;
  /** Work sets; an exercise with none yet still counts as one. */
  sets: number;
}

const groupOrder = (group: MuscleGroup) => MUSCLE_GROUPS.indexOf(group);

/** The groups worth naming, most sets first; equal sets go by the fixed order of groups. */
function rankedGroups(exercises: GroupWork[]): MuscleGroup[] {
  const totals = new Map<MuscleGroup, number>();
  for (const { muscle, sets } of exercises) {
    const group = groupOf(muscle);
    totals.set(group, (totals.get(group) ?? 0) + Math.max(1, sets));
  }
  const ranked = [...totals].sort((a, b) => b[1] - a[1] || groupOrder(a[0]) - groupOrder(b[0]));
  const all = ranked.reduce((sum, [, sets]) => sum + sets, 0);
  const named = ranked.filter(([group, sets]) => sets / all >= (LARGE.includes(group) ? LARGE_SHARE : SMALL_SHARE));
  return (named.length ? named : ranked.slice(0, 1)).slice(0, MAX_GROUPS).map(([group]) => group);
}

/**
 * What a workout trained: at most three groups. One triceps exercise after a chest day doesn't make
 * it an arms day. They're listed in the fixed order of groups, so a split keeps one name however its
 * sets fall on the day. Empty for a workout with no known exercises.
 */
export function mainGroups(exercises: GroupWork[]): MuscleGroup[] {
  return rankedGroups(exercises).sort((a, b) => groupOrder(a) - groupOrder(b));
}

/** The named group with the most sets, which is what the rotation goes by. */
export function leadingGroup(exercises: GroupWork[]): MuscleGroup | undefined {
  return rankedGroups(exercises)[0];
}
