/**
 * Pictures that show what a machine looks like. They come from Wikimedia Commons under free licences
 * and ship with the app, so they work offline and load nothing from another site. Each one is
 * resized and credited on the exercise page, as its licence asks. The files are in public/photos.
 * Rules for adding one: "Exercise photos" in CLAUDE.md.
 */

const LICENSES = {
  'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
  'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

export interface ExercisePhoto {
  file: string;
  width: number;
  height: number;
  author: string;
  license: keyof typeof LICENSES;
  licenseUrl: string;
  /** The picture's page on Commons, which keeps the original and its full terms. */
  source: string;
}

function photo(name: string, width: number, height: number, author: string, license: keyof typeof LICENSES, commonsFile: string): ExercisePhoto {
  return {
    file: `${name}.webp`,
    width,
    height,
    author,
    license,
    licenseUrl: LICENSES[license],
    source: `https://commons.wikimedia.org/wiki/File:${commonsFile}`,
  };
}

export const PHOTOS = {
  'chest-press': photo('chest-press', 647, 820, 'Everkinetic', 'CC BY-SA 3.0', 'Decline-chest-press-1.png'),
  'plate-incline-press': photo('plate-incline-press', 657, 820, 'Aliva Sahoo', 'CC BY-SA 4.0', 'Chest_Incline.jpg'),
  'pec-deck': photo('pec-deck', 617, 820, 'Aliva Sahoo', 'CC BY-SA 4.0', 'Pec_deck_Fly.jpg'),
  'cable-crossover': photo('cable-crossover', 703, 820, 'Everkinetic', 'CC BY-SA 3.0', 'Cable-crossover-1.png'),
  'plate-pulldown': photo('plate-pulldown', 617, 820, 'Aliva Sahoo', 'CC BY-SA 4.0', 'Back_Pull_Down.jpg'),
  'stack-pulldown': photo('stack-pulldown', 617, 820, 'Aliva Sahoo', 'CC BY-SA 4.0', 'Back_Pull_down.jpg'),
  'lat-pulldown': photo('lat-pulldown', 616, 820, 'Santeri Viinamäki', 'CC BY-SA 4.0', 'Lat_pulldown_machine_20180112.jpg'),
  'close-grip-pulldown': photo('close-grip-pulldown', 327, 820, 'Everkinetic', 'CC BY-SA 3.0', 'Close-grip-front-lat-pull-down-1.png'),
  'neutral-grip-pulldown': photo('neutral-grip-pulldown', 324, 820, 'Everkinetic', 'CC BY-SA 3.0', 'V-bar-pull-down-1.png'),
  'underhand-pulldown': photo('underhand-pulldown', 326, 820, 'Everkinetic', 'CC BY-SA 3.0', 'Underhand-pull-downs-1.png'),
  'straight-arm-pulldown': photo('straight-arm-pulldown', 335, 820, 'Everkinetic', 'CC BY-SA 3.0', 'Straight-arm-push-down-1.png'),
  'machine-row': photo('machine-row', 820, 732, 'Aliva Sahoo', 'CC BY-SA 4.0', 'Back_Machine.jpg'),
  'cable-row': photo('cable-row', 820, 551, 'Everkinetic', 'CC BY-SA 3.0', 'Cable-seated-rows-1.png'),
  smith: photo('smith', 617, 820, 'Aliva Sahoo', 'CC BY-SA 4.0', 'Bench_press_Machine.jpg'),
  'smith-upright-row': photo('smith-upright-row', 500, 622, 'Everkinetic', 'CC BY-SA 3.0', 'Smith-machine-upright-row-1.png'),
  'leg-press': photo('leg-press', 615, 820, 'Teemeah', 'CC BY-SA 4.0', 'Leg_press_machine.jpg'),
  'leg-extension': photo('leg-extension', 615, 820, 'Teemeah', 'CC BY-SA 4.0', 'Leg_extender_machine.jpg'),
  'seated-leg-curl': photo('seated-leg-curl', 500, 751, 'Everkinetic', 'CC BY-SA 3.0', 'Seated-leg-curl-1.png'),
  'hip-machine': photo('hip-machine', 615, 820, 'Teemeah', 'CC BY-SA 4.0', 'Hip_abductor_machine.jpg'),
  'seated-calf': photo('seated-calf', 820, 615, 'Teemeah', 'CC BY-SA 4.0', 'Seated_calf_machine.jpg'),
  'shoulder-press': photo('shoulder-press', 500, 731, 'Everkinetic', 'CC BY-SA 3.0', 'Shoulder-press-machine-1.png'),
  'machine-curl': photo('machine-curl', 617, 820, 'Aliva Sahoo', 'CC BY-SA 4.0', 'Bicep_curl_machine.jpg'),
  treadmill: photo('treadmill', 820, 569, 'GhoziSeptiandri', 'CC BY-SA 4.0', 'Treadmill-gym.jpg'),
  elliptical: photo('elliptical', 820, 639, 'Cpetro45', 'CC BY-SA 3.0', 'Elliptical_machine.jpg'),
  'exercise-bike': photo('exercise-bike', 820, 615, 'KeepActive Australia from Melbourne, VIC, Australia', 'CC BY-SA 4.0', 'Stationary_bikes_at_a_gym.jpg'),
  rowing: photo('rowing', 615, 820, 'rrafson', 'CC BY-SA 3.0', 'Rowing_machine.jpg'),
  'cable-station': photo('cable-station', 820, 546, 'San Francisco Foghorn', 'CC BY 2.0', 'Multifunctional_cable_and_row_machines_in_a_gym.jpg'),
};

/** Variations of an exercise share a picture: it shows the machine, not the grip. */
export const EXERCISE_PHOTOS: Record<string, keyof typeof PHOTOS> = {
  'machine-chest-press': 'chest-press',
  'plate-loaded-chest-press': 'chest-press',
  'plate-loaded-incline-press': 'plate-incline-press',
  'pec-deck': 'pec-deck',
  'reverse-pec-deck': 'pec-deck',
  'cable-crossover': 'cable-crossover',
  'machine-pulldown': 'plate-pulldown',
  'selectorized-pulldown': 'stack-pulldown',
  'lat-pulldown': 'lat-pulldown',
  'close-grip-pulldown': 'close-grip-pulldown',
  'neutral-grip-pulldown': 'neutral-grip-pulldown',
  'underhand-pulldown': 'underhand-pulldown',
  'straight-arm-pulldown': 'straight-arm-pulldown',
  'chest-supported-row': 'machine-row',
  'upper-back-row': 'machine-row',
  'machine-row': 'machine-row',
  'seated-cable-row': 'cable-row',
  'wide-cable-row': 'cable-row',
  'neutral-grip-cable-row': 'cable-row',
  'close-grip-cable-row': 'cable-row',
  'smith-squat': 'smith',
  'smith-lunge': 'smith',
  'smith-calf-raise': 'smith',
  'smith-shoulder-press': 'smith',
  'smith-upright-row': 'smith-upright-row',
  'leg-press': 'leg-press',
  'leg-press-narrow': 'leg-press',
  'plate-loaded-leg-press': 'leg-press',
  'single-leg-press': 'leg-press',
  'leg-extension': 'leg-extension',
  'seated-leg-curl': 'seated-leg-curl',
  'hip-adductor': 'hip-machine',
  'hip-abductor': 'hip-machine',
  'seated-calf-raise': 'seated-calf',
  'machine-shoulder-press': 'shoulder-press',
  'machine-curl': 'machine-curl',
  treadmill: 'treadmill',
  elliptical: 'elliptical',
  'exercise-bike': 'exercise-bike',
  'rowing-machine': 'rowing',
  'cable-lateral-raise': 'cable-station',
  'face-pull': 'cable-station',
  'cable-curl': 'cable-station',
  'rope-pushdown': 'cable-station',
  'cable-pushdown': 'cable-station',
  'cable-crunch': 'cable-station',
};

export function photoOf(exerciseId: string): ExercisePhoto | undefined {
  const key = EXERCISE_PHOTOS[exerciseId];
  return key && PHOTOS[key];
}

export function photoUrl(photo: ExercisePhoto): string {
  return `${import.meta.env.BASE_URL}photos/${photo.file}`;
}
