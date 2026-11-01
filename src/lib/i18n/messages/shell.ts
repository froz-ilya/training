import type { RuTranslation, Translation } from './translation';

/** The app's frame: tabs, offline banner, the update screen. */
export const en = {
  'shell.actions': 'Actions',
  'shell.loading': 'Loading…',
  'shell.offline': 'Offline',
  'shell.sheet': 'Sheet',
  'shell.tab.nav': 'Main navigation',
  'shell.tab.today': 'Today',
  'shell.tab.history': 'History',
  'shell.tab.progress': 'Progress',
  'shell.tab.exercises': 'Exercises',
  'shell.tab.settings': 'Settings',
  'shell.update.title': 'Update needed',
  'shell.update.body': 'Your data was saved by a newer version of the app. It is safe. Reload to get the latest version.',
  'shell.update.reload': 'Reload',
} as const;

export const de: Translation<typeof en> = {
  'shell.actions': 'Aktionen',
  'shell.loading': 'Wird geladen…',
  'shell.offline': 'Offline',
  'shell.sheet': 'Fenster',
  'shell.tab.nav': 'Hauptnavigation',
  'shell.tab.today': 'Heute',
  'shell.tab.history': 'Verlauf',
  'shell.tab.progress': 'Fortschritt',
  'shell.tab.exercises': 'Übungen',
  'shell.tab.settings': 'Einstellungen',
  'shell.update.title': 'Update nötig',
  'shell.update.body': 'Deine Daten wurden von einer neueren App-Version gespeichert. Sie sind sicher. Lade neu, um die aktuelle Version zu bekommen.',
  'shell.update.reload': 'Neu laden',
};

export const ru: RuTranslation<typeof en> = {
  'shell.actions': 'Действия',
  'shell.loading': 'Загрузка…',
  'shell.offline': 'Нет сети',
  'shell.sheet': 'Панель',
  'shell.tab.nav': 'Основная навигация',
  'shell.tab.today': 'Сегодня',
  'shell.tab.history': 'История',
  'shell.tab.progress': 'Прогресс',
  'shell.tab.exercises': 'Упражнения',
  'shell.tab.settings': 'Настройки',
  'shell.update.title': 'Нужно обновление',
  'shell.update.body': 'Данные сохранены более новой версией приложения. Они в безопасности. Перезагрузите, чтобы получить последнюю версию.',
  'shell.update.reload': 'Перезагрузить',
};
