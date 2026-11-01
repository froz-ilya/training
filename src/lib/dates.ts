import { locale } from './i18n.svelte';

/** Local date as YYYY-MM-DD: workouts belong to the day they happened where the user was. */
export function toISODate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Noon, so daylight saving changes never shift a date by a day. */
export function fromISODate(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((fromISODate(to).getTime() - fromISODate(from).getTime()) / 86400000);
}

export function fmtDate(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  return fromISODate(date).toLocaleDateString(locale(), options);
}
