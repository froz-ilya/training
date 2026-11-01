import type { Equipment, Exercise, ExerciseSettings } from '../types';

/** A typical plate or stack jump for each kind of equipment. */
const DEFAULT_STEP_KG: Record<Equipment, number> = {
  barbell: 2.5,
  smith: 2.5,
  dumbbell: 2,
  cable: 2.5,
  machine: 5,
  bodyweight: 2.5,
  other: 2.5,
};

/** How far the weight buttons move: the exercise's own step, or the usual one for its equipment. */
export function weightStep(exercise: Exercise | undefined, settings?: ExerciseSettings): number {
  return settings?.stepKg || (exercise ? DEFAULT_STEP_KG[exercise.equipment] : 2.5);
}

/** Up or down one step, without the float noise of 0.1 + 0.2. */
export function stepValue(value: number, step: number, direction: -1 | 1, min = 0): number {
  return Math.max(min, Math.round((value + direction * step) * 1000) / 1000);
}
