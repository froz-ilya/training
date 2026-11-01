import { newId } from '../db/schema';
import type { CustomExercise, Equipment, Lang, Load, Muscle } from '../types';

export interface CustomDraft {
  names: Partial<Record<Lang, string>>;
  muscle: Muscle;
  equipment: Equipment;
  load: Load;
}

/** Empty names stay empty: names are shown with a fallback to any language that has one. */
export function createCustomExercise(draft: CustomDraft, now = Date.now()): CustomExercise {
  return {
    id: `custom-${newId()}`,
    names: {
      en: draft.names.en?.trim() ?? '',
      de: draft.names.de?.trim() ?? '',
      ru: draft.names.ru?.trim() ?? '',
    },
    muscle: draft.muscle,
    equipment: draft.equipment,
    load: draft.load,
    compound: false,
    createdAt: now,
  };
}

/** A name read from a log goes under the language it's written in. */
export function nameFields(name: string): Partial<Record<Lang, string>> {
  return /\p{Script=Cyrillic}/u.test(name) ? { ru: name } : { en: name };
}
