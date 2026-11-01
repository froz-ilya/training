import type { RuTranslation, Translation } from './translation';

/** Comments and tags on exercises. */
export const en = {
  'notes.add': 'Comment',
  'notes.title.exercise': 'Comment on this exercise',
  'notes.title.set': 'Comment on this set',
  'notes.tags': 'Tags',
  'notes.text': 'Comment',
  'notes.placeholder': 'Anything worth remembering',
  'notes.hint': 'Tags marked as an off day stop a session counting against this exercise. A new best still counts.',
  'notes.remove': 'Remove comment',

  'notes.tag.badSpotter': 'Bad spotter',
  'notes.tag.tired': 'Tired',
  'notes.tag.poorSleep': 'Poor sleep',
  'notes.tag.sick': 'Sick',
  'notes.tag.pain': 'Pain',
  'notes.tag.shortOnTime': 'Short on time',
  'notes.tag.busyGym': 'Busy gym',
  'notes.tag.removed': 'Removed tag',
} as const;

export const de: Translation<typeof en> = {
  'notes.add': 'Kommentar',
  'notes.title.exercise': 'Kommentar zu dieser Übung',
  'notes.title.set': 'Kommentar zu diesem Satz',
  'notes.tags': 'Tags',
  'notes.text': 'Kommentar',
  'notes.placeholder': 'Alles, was du dir merken willst',
  'notes.hint': 'Tags für einen schlechten Tag zählen die Sitzung nicht gegen diese Übung. Ein neuer Bestwert zählt trotzdem.',
  'notes.remove': 'Kommentar entfernen',

  'notes.tag.badSpotter': 'Schlechter Spotter',
  'notes.tag.tired': 'Müde',
  'notes.tag.poorSleep': 'Schlecht geschlafen',
  'notes.tag.sick': 'Krank',
  'notes.tag.pain': 'Schmerzen',
  'notes.tag.shortOnTime': 'Wenig Zeit',
  'notes.tag.busyGym': 'Volles Studio',
  'notes.tag.removed': 'Entfernter Tag',
};

export const ru: RuTranslation<typeof en> = {
  'notes.add': 'Комментарий',
  'notes.title.exercise': 'Комментарий к упражнению',
  'notes.title.set': 'Комментарий к подходу',
  'notes.tags': 'Метки',
  'notes.text': 'Комментарий',
  'notes.placeholder': 'Всё, что стоит запомнить',
  'notes.hint': 'С метками неудачного дня тренировка не считается против этого упражнения. Новый рекорд всё равно засчитывается.',
  'notes.remove': 'Удалить комментарий',

  'notes.tag.badSpotter': 'Плохая страховка',
  'notes.tag.tired': 'Усталость',
  'notes.tag.poorSleep': 'Плохой сон',
  'notes.tag.sick': 'Болезнь',
  'notes.tag.pain': 'Боль',
  'notes.tag.shortOnTime': 'Мало времени',
  'notes.tag.busyGym': 'Много людей',
  'notes.tag.removed': 'Удалённая метка',
};
