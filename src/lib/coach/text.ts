import { fmtDate, toISODate } from '../dates';
import { fmtNumber, t, tn } from '../i18n.svelte';
import type { Load, StallAction } from '../types';
import type { ExerciseState, ExerciseStatus } from './status';
import type { SessionSet } from './strength';
import type { Suggestion } from './suggest';

export function fmtKg(weightKg: number): string {
  return t('common.kg', { n: weightKg });
}

export function fmtSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "77.5 kg × 7", "12 reps" for bodyweight, "1:40" for timed sets. */
export function fmtSet(set: Pick<SessionSet, 'weightKg' | 'reps' | 'seconds'>, load: Load): string {
  if (load === 'time' || (set.seconds && !set.reps)) return fmtSeconds(set.seconds ?? 0);
  if (set.weightKg <= 0) return tn('coach.reps', set.reps);
  const weight = fmtKg(set.weightKg);
  return load === 'body' ? `+${weight} × ${fmtNumber(set.reps)}` : `${weight} × ${fmtNumber(set.reps)}`;
}

export function stateLabel(state: ExerciseState): string {
  return t(`coach.state.${state}`);
}

export function stateText(state: ExerciseState): string {
  return t(`coach.state.${state}.text`);
}

/** "12 March", with the year when it isn't this one. Long months read right inside a sentence. */
function dayInText(date: string): string {
  const year = date.slice(0, 4) === toISODate().slice(0, 4) ? {} : { year: 'numeric' as const };
  return fmtDate(date, { day: 'numeric', month: 'long', ...year });
}

/** What the status means for this exercise, and why a restarted comparison has so little to say. */
export function statusText(status: ExerciseStatus, sessionsSince: number): string {
  if (!status.restartedOn) return stateText(status.state);
  const date = dayInText(status.restartedOn);
  return t(sessionsSince ? 'coach.restart.early' : 'coach.restart.waiting', { date });
}

/**
 * Why this suggestion, in a sentence. "Last time" is only said of the latest session: one built on
 * an earlier session names its date.
 */
export function reasonText(s: Suggestion): string {
  const { weightKg, reps, seconds, target, low, high, days, load, baseDate } = s.params;
  const last = fmtSet({ weightKg, reps, seconds }, load);
  const date = baseDate && dayInText(baseDate);
  const timed = load === 'time' || (seconds > 0 && !reps);
  switch (s.reason) {
    case 'up':
      return date ? t('coach.reason.up.dated', { last, low, high, date }) : t('coach.reason.up', { last, low, high });
    case 'moreReps':
      return date ? t('coach.reason.moreReps.dated', { last, target, date }) : t('coach.reason.moreReps', { last, target });
    case 'moreTime':
      return date
        ? t('coach.reason.moreTime.dated', { last, target: fmtSeconds(target), date })
        : t('coach.reason.moreTime', { last, target: fmtSeconds(target) });
    case 'hold':
      return date ? t('coach.reason.hold.dated', { last, low, high, target, date }) : t('coach.reason.hold', { last, low, high, target });
    case 'down':
      return t('coach.reason.down', { low, high });
    case 'afterBreak':
      return date
        ? t('coach.reason.afterBreak.dated', { days: tn('common.days', days), date })
        : t('coach.reason.afterBreak', { days: tn('common.days', days) });
    case 'afterBreakReps':
      return date
        ? t('coach.reason.afterBreakReps.dated', { days: tn('common.days', days), date })
        : t('coach.reason.afterBreakReps', { days: tn('common.days', days) });
    case 'afterBreakTime':
      return date
        ? t('coach.reason.afterBreakTime.dated', { days: tn('common.days', days), date })
        : t('coach.reason.afterBreakTime', { days: tn('common.days', days) });
    case 'afterBreakSame':
      return date
        ? t('coach.reason.afterBreakSame.dated', { days: tn('common.days', days), date })
        : t('coach.reason.afterBreakSame', { days: tn('common.days', days) });
    case 'maintain':
      return date ? t('coach.reason.maintain.dated', { date }) : t('coach.reason.maintain');
    case 'noIncrease':
      return t('coach.reason.noIncrease');
    case 'lighterWeek':
      return t('coach.reason.lighterWeek');
    case 'pain':
      return t('coach.reason.pain');
    case 'laterInWorkout':
      if (date) return t(timed ? 'coach.reason.laterTime.dated' : 'coach.reason.later.dated', { date });
      return t(timed ? 'coach.reason.laterTime' : 'coach.reason.later');
    case 'earlierInWorkout':
      return date ? t('coach.reason.earlier.dated', { date }) : t('coach.reason.earlier');
  }
}

export function actionLabel(action: StallAction): string {
  return t(`coach.action.${action}`);
}

export function actionText(action: StallAction): string {
  return t(`coach.action.${action}.text`);
}

/** Why "train it more often" sits low: the rotation leaves little room for it. */
export function rotationLimitText(perWeek: number): string {
  return t('coach.action.frequency.limit', { perWeek });
}
