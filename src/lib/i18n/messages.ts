import type { UiLang } from '../types';
import * as coach from './messages/coach';
import * as common from './messages/common';
import * as exercises from './messages/exercises';
import * as importing from './messages/import';
import * as notes from './messages/notes';
import * as progress from './messages/progress';
import * as settings from './messages/settings';
import * as shell from './messages/shell';
import * as workout from './messages/workout';

/** One flat catalog per language, made of one file per area of the app. */
const en = {
  ...common.en,
  ...shell.en,
  ...settings.en,
  ...exercises.en,
  ...importing.en,
  ...workout.en,
  ...progress.en,
  ...coach.en,
  ...notes.en,
};

export type Messages = typeof en;
export type MsgKey = keyof Messages;

const de: Record<MsgKey, string> = {
  ...common.de,
  ...shell.de,
  ...settings.de,
  ...exercises.de,
  ...importing.de,
  ...workout.de,
  ...progress.de,
  ...coach.de,
  ...notes.de,
};

const ru: Record<MsgKey, string> = {
  ...common.ru,
  ...shell.ru,
  ...settings.ru,
  ...exercises.ru,
  ...importing.ru,
  ...workout.ru,
  ...progress.ru,
  ...coach.ru,
  ...notes.ru,
};

export const catalogs: Record<UiLang, Record<MsgKey, string>> = { en, de, ru };
