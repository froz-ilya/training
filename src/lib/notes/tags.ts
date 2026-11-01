import type { CustomTag, ExerciseNote } from '../types';

/**
 * Tags on comments. Built-in ones have a fixed id and text in the message files; a user's own tags
 * live in settings. An off-day tag means a session says little about the exercise, so it doesn't
 * count against it, while a new best in that session still counts.
 */

export const BUILT_IN_TAGS = ['badSpotter', 'tired', 'poorSleep', 'sick', 'pain', 'shortOnTime', 'busyGym'] as const;

export type BuiltInTag = (typeof BUILT_IN_TAGS)[number];

export function isBuiltInTag(tag: string): tag is BuiltInTag {
  return (BUILT_IN_TAGS as readonly string[]).includes(tag);
}

export function isOffDayTag(tag: string, customTags: CustomTag[]): boolean {
  return isBuiltInTag(tag) || customTags.some((c) => c.id === tag && c.offDay);
}

export function isOffDay(notes: Pick<ExerciseNote, 'tags'>[], customTags: CustomTag[]): boolean {
  return notes.some((n) => n.tags.some((tag) => isOffDayTag(tag, customTags)));
}

export function hasPain(notes: Pick<ExerciseNote, 'tags'>[]): boolean {
  return notes.some((n) => n.tags.includes('pain'));
}
