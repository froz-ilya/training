import type { Equipment, Exercise } from '../types';

/**
 * How much an exercise costs the whole workout, not how much someone lifts or what it trains.
 * `compound` is too coarse: a Bulgarian split squat and a machine chest press are both compound.
 * This table lives apart from the catalogue and from anything stored, so it can change freely.
 * src/lib/catalog/difficulty.test.ts keeps it in step with the catalogue.
 */

export type Difficulty = 'light' | 'medium' | 'hard';

/** What each level adds to a workout's cost. */
export const DIFFICULTY_POINTS: Record<Difficulty, number> = { light: 1, medium: 2, hard: 3 };

const EXERCISES: [Difficulty, string[]][] = [
  // The spine or the whole body carries the load through the set.
  ['hard', ['barbell-squat', 'front-squat', 'deadlift', 'romanian-deadlift', 'overhead-press', 'clean-and-press', 'kettlebell-swing', 'burpee', 'farmers-walk']],
  // With nothing under the chest, the lower back holds the torso up through the whole set.
  ['hard', ['barbell-row', 't-bar-row', 'underhand-barbell-row']],
  // Balance under load: one leg does the work with nothing to steady the body.
  ['hard', ['bulgarian-split-squat', 'lunge', 'pistol-squat', 'step-up']],

  // A bench or a seat holds the body still.
  [
    'medium',
    [
      'barbell-bench-press',
      'incline-barbell-press',
      'decline-barbell-press',
      'close-grip-bench-press',
      'dumbbell-bench-press',
      'incline-dumbbell-press',
      'machine-chest-press',
      'plate-loaded-chest-press',
      'plate-loaded-incline-press',
      'seated-dip-machine',
      'dumbbell-shoulder-press',
      'machine-shoulder-press',
      'smith-shoulder-press',
      'lat-pulldown',
      'close-grip-pulldown',
      'machine-pulldown',
      'selectorized-pulldown',
      'neutral-grip-pulldown',
      'underhand-pulldown',
      'seated-cable-row',
      'chest-supported-row',
      'wide-cable-row',
      'neutral-grip-cable-row',
      'close-grip-cable-row',
      'upper-back-row',
      'machine-row',
      'hip-thrust',
    ],
  ],
  // A hand on the bench keeps the lower back out of it.
  ['medium', ['dumbbell-row']],
  // The machine or the rails steer the weight, so balance plays no part.
  ['medium', ['smith-squat', 'smith-lunge', 'smith-upright-row', 'hack-squat', 'leg-press', 'leg-press-narrow', 'plate-loaded-leg-press', 'single-leg-press']],
  // Only body weight to move, and nothing to balance.
  [
    'medium',
    [
      'dips',
      'push-up',
      'close-grip-push-up',
      'incline-push-up',
      'bench-dip',
      'pull-up',
      'chin-up',
      'neutral-grip-pull-up',
      'inverted-row',
      'trx-row',
      'bodyweight-squat',
    ],
  ],
  // Standing, but the arms cap the weight long before the back or the legs would.
  ['medium', ['goblet-squat', 'plie-squat', 'upright-row']],
  // One joint, but the lower back it tires is the one the heavy lifts need.
  ['medium', ['back-extension']],
  // Abs, but the whole body is held rigid against its own weight.
  ['medium', ['dragon-flag', 'dragon-flag-hold']],

  ['light', ['pec-deck', 'dumbbell-fly', 'incline-dumbbell-fly', 'cable-crossover']],
  ['light', ['straight-arm-pulldown', 'shrug']],
  ['light', ['leg-extension', 'lying-leg-curl', 'seated-leg-curl', 'wall-sit', 'hip-adductor', 'hip-abductor']],
  ['light', ['standing-calf-raise', 'smith-calf-raise', 'seated-calf-raise', 'single-leg-calf-raise']],
  ['light', ['plate-front-raise', 'lateral-raise', 'machine-lateral-raise', 'cable-lateral-raise', 'rear-delt-fly', 'reverse-pec-deck', 'face-pull']],
  ['light', ['barbell-curl', 'dumbbell-curl', 'incline-dumbbell-curl', 'hammer-curl', 'preacher-curl', 'ez-bar-curl', 'machine-curl', 'cable-curl', 'concentration-curl']],
  ['light', ['rope-pushdown', 'cable-pushdown', 'skull-crusher', 'overhead-triceps-extension']],
  ['light', ['wrist-curl', 'reverse-wrist-curl']],
  [
    'light',
    [
      'crunch',
      'plank-step-up',
      'decline-crunch',
      'cable-crunch',
      'ab-machine',
      'oblique-machine',
      'hanging-leg-raise',
      'captains-chair-leg-raise',
      'v-up',
      'trx-knee-tuck',
      'mountain-climber',
      'russian-twist',
      'plank',
      'high-plank',
    ],
  ],
  // Cardio is never planned, but it still needs a level.
  ['light', ['treadmill', 'elliptical', 'exercise-bike', 'rowing-machine', 'jumping-jack']],
];

export const CATALOG_DIFFICULTY = new Map(EXERCISES.flatMap(([level, ids]) => ids.map((id) => [id, level] as const)));

/** On these, a compound lift has nothing to guide the weight. */
const UNGUIDED: Equipment[] = ['barbell', 'dumbbell', 'other'];

export function difficultyOf(exercise: Pick<Exercise, 'id' | 'compound' | 'equipment'>): Difficulty {
  const listed = CATALOG_DIFFICULTY.get(exercise.id);
  if (listed) return listed;
  if (!exercise.compound) return 'light';
  return UNGUIDED.includes(exercise.equipment) ? 'hard' : 'medium';
}

export function difficultyPoints(exercise: Pick<Exercise, 'id' | 'compound' | 'equipment'>): number {
  return DIFFICULTY_POINTS[difficultyOf(exercise)];
}
