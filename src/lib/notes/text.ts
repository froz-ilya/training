import { t } from '../i18n.svelte';
import type { CustomTag, ExerciseNote } from '../types';
import { isBuiltInTag } from './tags';

/** A tag as text. A deleted custom tag keeps the label saved with the comment. */
export function tagLabel(tag: string, customTags: CustomTag[], note?: Pick<ExerciseNote, 'labels'>): string {
  if (isBuiltInTag(tag)) return t(`notes.tag.${tag}`);
  return customTags.find((c) => c.id === tag)?.label ?? note?.labels?.[tag] ?? t('notes.tag.removed');
}
