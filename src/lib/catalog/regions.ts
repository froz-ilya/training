import type { BodyRegion, Exercise, Muscle } from '../types';

/**
 * Which parts of the body an exercise works. `Muscle` is too coarse for a body map: a lateral raise
 * and a face pull are both "shoulders". This table lives apart from the catalogue and from anything
 * stored, so it can change freely. src/lib/catalog/regions.test.ts keeps it in step with the catalogue.
 */

export const BODY_REGIONS: BodyRegion[] = [
  'chest',
  'frontDelts',
  'sideDelts',
  'rearDelts',
  'upperBack',
  'lats',
  'lowerBack',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
];

export interface RegionWork {
  main: BodyRegion[];
  /** Regions that do real work but aren't what the exercise is for. */
  helpers: BodyRegion[];
}

const work = (main: BodyRegion[], helpers: BodyRegion[] = []): RegionWork => ({ main, helpers });

const NONE = work([]);
const CHEST_PRESS = work(['chest'], ['triceps', 'frontDelts']);
const NARROW_PRESS = work(['triceps'], ['chest', 'frontDelts']);
const PULLDOWN = work(['lats'], ['biceps', 'upperBack']);
const PULL_UP = work(['lats'], ['biceps', 'upperBack', 'forearms']);
const ROW = work(['lats', 'upperBack'], ['biceps', 'rearDelts']);
/** With nothing under the chest, the lower back holds the torso up through the whole set. */
const BENT_ROW = work(ROW.main, [...ROW.helpers, 'lowerBack']);
const SQUAT = work(['quads'], ['glutes']);
/** A deep or wide squat, one leg, a split stance or a step-up: the hip does as much as the knee. */
const HIP_SQUAT = work(['quads', 'glutes']);
const SHOULDER_PRESS = work(['frontDelts'], ['sideDelts', 'triceps']);
const UPRIGHT_ROW = work(['sideDelts'], ['upperBack', 'biceps']);
const REAR_DELTS = work(['rearDelts'], ['upperBack']);

const EXERCISES: [RegionWork, string[]][] = [
  [
    CHEST_PRESS,
    [
      'barbell-bench-press',
      'incline-barbell-press',
      'decline-barbell-press',
      'dumbbell-bench-press',
      'incline-dumbbell-press',
      'machine-chest-press',
      'plate-loaded-chest-press',
      'plate-loaded-incline-press',
      'dips',
      'push-up',
      'incline-push-up',
    ],
  ],
  [work(['chest']), ['pec-deck', 'dumbbell-fly', 'incline-dumbbell-fly', 'cable-crossover']],
  [PULL_UP, ['pull-up', 'chin-up', 'neutral-grip-pull-up']],
  [PULLDOWN, ['lat-pulldown', 'close-grip-pulldown', 'machine-pulldown', 'selectorized-pulldown', 'neutral-grip-pulldown', 'underhand-pulldown']],
  [work(['lats']), ['straight-arm-pulldown']],
  [
    ROW,
    [
      'inverted-row',
      'trx-row',
      'seated-cable-row',
      'chest-supported-row',
      'wide-cable-row',
      'neutral-grip-cable-row',
      'close-grip-cable-row',
      'machine-row',
      'dumbbell-row',
    ],
  ],
  [BENT_ROW, ['barbell-row', 't-bar-row', 'underhand-barbell-row']],
  [work(['upperBack'], ['rearDelts', 'lats', 'biceps']), ['upper-back-row']],
  [work(['upperBack']), ['shrug']],
  [work(['lowerBack', 'glutes', 'hamstrings'], ['quads', 'upperBack', 'forearms']), ['deadlift']],
  [work(['hamstrings', 'glutes'], ['lowerBack']), ['romanian-deadlift']],
  [work(['lowerBack'], ['glutes', 'hamstrings']), ['back-extension']],
  [
    SQUAT,
    [
      'smith-squat',
      'front-squat',
      'bodyweight-squat',
      'goblet-squat',
      'hack-squat',
      'leg-press',
      'leg-press-narrow',
      'plate-loaded-leg-press',
      'single-leg-press',
    ],
  ],
  [HIP_SQUAT, ['barbell-squat', 'plie-squat', 'bulgarian-split-squat', 'lunge', 'smith-lunge', 'pistol-squat', 'step-up']],
  [work(['quads']), ['leg-extension', 'wall-sit']],
  [work(['hamstrings']), ['lying-leg-curl', 'seated-leg-curl']],
  [work(['glutes'], ['hamstrings']), ['hip-thrust']],
  [work(['glutes']), ['hip-abductor']],
  // The inner thigh has no region of its own, and sits beside the quads on the map.
  [work([], ['quads']), ['hip-adductor']],
  [work(['calves']), ['standing-calf-raise', 'smith-calf-raise', 'seated-calf-raise', 'single-leg-calf-raise']],
  [SHOULDER_PRESS, ['overhead-press', 'dumbbell-shoulder-press', 'machine-shoulder-press', 'smith-shoulder-press']],
  [work(['frontDelts']), ['plate-front-raise']],
  [work(['sideDelts']), ['lateral-raise', 'machine-lateral-raise', 'cable-lateral-raise']],
  [REAR_DELTS, ['rear-delt-fly', 'reverse-pec-deck', 'face-pull']],
  [UPRIGHT_ROW, ['upright-row', 'smith-upright-row']],
  [work(['biceps']), ['barbell-curl', 'dumbbell-curl', 'incline-dumbbell-curl', 'preacher-curl', 'ez-bar-curl', 'machine-curl', 'cable-curl', 'concentration-curl']],
  [work(['biceps'], ['forearms']), ['hammer-curl']],
  [work(['triceps']), ['rope-pushdown', 'cable-pushdown', 'skull-crusher', 'overhead-triceps-extension']],
  [NARROW_PRESS, ['seated-dip-machine', 'close-grip-bench-press', 'close-grip-push-up']],
  [work(['triceps'], ['frontDelts']), ['bench-dip']],
  [work(['forearms']), ['wrist-curl', 'reverse-wrist-curl']],
  [work(['forearms'], ['upperBack']), ['farmers-walk']],
  [
    work(['abs']),
    [
      'crunch',
      'plank-step-up',
      'decline-crunch',
      'cable-crunch',
      'ab-machine',
      'oblique-machine',
      'captains-chair-leg-raise',
      'dragon-flag',
      'dragon-flag-hold',
      'v-up',
      'trx-knee-tuck',
      'mountain-climber',
      'russian-twist',
      'plank',
      'high-plank',
    ],
  ],
  [work(['abs'], ['forearms']), ['hanging-leg-raise']],
  [NONE, ['treadmill', 'elliptical', 'exercise-bike', 'rowing-machine', 'jumping-jack']],
  [work([], ['chest', 'quads', 'abs']), ['burpee']],
  [work(['glutes'], ['hamstrings', 'lowerBack']), ['kettlebell-swing']],
  [work([], ['quads', 'glutes', 'lowerBack', 'upperBack', 'frontDelts', 'triceps']), ['clean-and-press']],
];

export const CATALOG_REGIONS = new Map(EXERCISES.flatMap(([regions, ids]) => ids.map((id) => [id, regions] as const)));

/** A user's own exercise has only a muscle to go by, so this is the usual way of training it. */
const BY_MUSCLE: Record<Muscle, RegionWork> = {
  chest: work(['chest']),
  back: work(['lats'], ['upperBack']),
  shoulders: work(['sideDelts'], ['frontDelts', 'rearDelts']),
  biceps: work(['biceps']),
  triceps: work(['triceps']),
  forearms: work(['forearms']),
  legs: work(['quads'], ['hamstrings', 'glutes']),
  glutes: work(['glutes']),
  calves: work(['calves']),
  abs: work(['abs']),
  cardio: NONE,
  fullBody: NONE,
};

export function regionsOf(exercise: Pick<Exercise, 'id' | 'muscle' | 'helpers'>): RegionWork {
  const listed = CATALOG_REGIONS.get(exercise.id);
  if (listed) return listed;
  const { main, helpers } = BY_MUSCLE[exercise.muscle];
  // This runs while a page draws, and a damaged backup can put anything in `helpers`.
  const own = Array.isArray(exercise.helpers) ? exercise.helpers : [];
  const extra = own.flatMap((muscle) => BY_MUSCLE[muscle]?.main ?? []);
  return { main, helpers: [...new Set([...helpers, ...extra])].filter((region) => !main.includes(region)) };
}

/** What several exercises come to together: a region is main if any of them is mainly for it. */
export function combinedWork(list: RegionWork[]): RegionWork {
  const main = BODY_REGIONS.filter((region) => list.some((work) => work.main.includes(region)));
  const helpers = BODY_REGIONS.filter((region) => !main.includes(region) && list.some((work) => work.helpers.includes(region)));
  return { main, helpers };
}

/** How hard an exercise works a region. A region with no level isn't worked. */
export type RegionLevel = 'main' | 'helper';
export type RegionLevels = Partial<Record<BodyRegion, RegionLevel>>;

export function regionLevels({ main, helpers }: RegionWork): RegionLevels {
  const levels: RegionLevels = {};
  for (const region of helpers) levels[region] = 'helper';
  for (const region of main) levels[region] = 'main';
  return levels;
}
