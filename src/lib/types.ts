export type Lang = 'en' | 'de' | 'ru';
export type UiLang = Lang;
export type UiLangSetting = 'auto' | Lang;
export type ThemeSetting = 'auto' | 'light' | 'dark';

export interface Settings {
  id: 'main';
  uiLang: UiLangSetting;
  /** Language exercise names are shown in; 'auto' follows the interface. */
  exerciseLang: UiLangSetting;
  theme: ThemeSetting;
  /** Used to compare bodyweight exercises; 0 = not set. */
  bodyWeightKg: number;
  /** Workouts a week the user aims for; 0 = work it out from their history. */
  workoutsPerWeek: number;
  /** Tags the user added for comments; built-in ones aren't stored here. */
  customTags: CustomTag[];
  backupEvery: number;
  lastBackupAt: number;
  backupSnoozeUntil: number;
}

export interface CustomTag {
  id: string;
  label: string;
  /** A session with this tag doesn't count against the exercise. */
  offDay: boolean;
}

export type Muscle =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'legs'
  | 'glutes'
  | 'calves'
  | 'abs'
  | 'cardio'
  | 'fullBody';

export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'smith' | 'bodyweight' | 'other';

/** How an exercise is measured: weight × reps, bodyweight + added weight × reps, or a duration. */
export type Load = 'weight' | 'body' | 'time';

export interface Exercise {
  id: string;
  names: Record<Lang, string>;
  muscle: Muscle;
  equipment: Equipment;
  load: Load;
  /** Multi-joint lifts get a lower rep range than isolation work by default. */
  compound: boolean;
  /** Other names this exercise goes by, in any language; used by search and import. */
  aliases?: string[];
  /** Done at a bar or platform height the user sets, which changes how hard it is. */
  levels?: boolean;
}

/** An exercise a user added; its id starts with "custom-" so it never clashes with the catalogue. */
export interface CustomExercise extends Exercise {
  createdAt: number;
}

export type WorkoutStatus = 'planned' | 'active' | 'done';

export interface Workout {
  id: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  status: WorkoutStatus;
  source: 'app' | 'import';
  note?: string;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
  /** Imported workouts keep their original text, so a better importer can read them again. */
  rawText?: string;
  /** Stable key of an imported workout; importing the same data twice adds nothing. */
  sourceKey?: string;
}

export type SetKind = 'warmup' | 'work';

export interface WorkoutSet {
  id: string;
  workoutId: string;
  exerciseId: string;
  /** Same as the workout's date, kept here so an exercise's history reads in one query. */
  date: string;
  /** Position of the exercise in the workout. */
  entry: number;
  /** Position of the set within the exercise. */
  order: number;
  kind: SetKind;
  /** Total weight; for bodyweight exercises the weight added to the body. */
  weightKg: number;
  reps: number;
  /** For timed exercises, instead of reps. */
  seconds?: number;
  /** Taken to the point where another rep wasn't possible. */
  failure?: boolean;
  /** The bar or platform height, as numbered in the gym. Whether higher is easier depends on the exercise. */
  level?: number;
  done: boolean;
  note?: string;
}

/** A comment on an exercise in a workout, or on one of its sets when `setId` is given. */
export interface ExerciseNote {
  id: string;
  workoutId: string;
  exerciseId: string;
  date: string;
  /** Built-in tag ids and custom tag ids. */
  tags: string[];
  text?: string;
  setId?: string;
  /** Custom tags' labels when saved, so a tag deleted later still reads properly. */
  labels?: Record<string, string>;
}

/** A name from an imported log, mapped to an exercise. */
export interface Alias {
  name: string;
  exerciseId: string;
}

export type ExerciseGoal = 'progress' | 'maintain';

/** What a user set for an exercise; anything missing falls back to a default. */
export interface ExerciseSettings {
  exerciseId: string;
  /** Machine setting, in the user's words: "seat 8". */
  machineSetting?: string;
  stepKg?: number;
  repLow?: number;
  repHigh?: number;
  goal?: ExerciseGoal;
}

/** A machine or gym change: comparisons of the exercise restart from this date. */
export interface Baseline {
  id: string;
  exerciseId: string;
  date: string;
  note?: string;
}

export type StallAction = 'repRange' | 'frequency' | 'lighterWeek' | 'swap' | 'maintain';

/** What a user tried for a plateau; `helped` is filled in once the outcome is known. */
export interface StallRecord {
  id: string;
  exerciseId: string;
  action: StallAction;
  date: string;
  helped?: boolean;
}
