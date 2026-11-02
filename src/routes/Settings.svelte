<script lang="ts">
  import { version } from '../../package.json';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import { lastBackupLabel, runBackup } from '../lib/backupReminder';
  import { avoidedExercises, saveExerciseSettings } from '../lib/coach/data';
  import { fmtKg } from '../lib/coach/text';
  import { applyBackup, readBackup, type BackupContents } from '../lib/db/backup';
  import { KEEP_COPIES, listCopies, restoreCopy, type SafetyCopy } from '../lib/db/safety';
  import { db } from '../lib/db/schema';
  import { nameOf } from '../lib/exercises.svelte';
  import { locale, t, tn } from '../lib/i18n.svelte';
  import { install, promptInstall, showIOSInstallHint } from '../lib/install.svelte';
  import { live } from '../lib/live.svelte';
  import { go } from '../lib/router.svelte';
  import { loadSettings, saveSettings, settings } from '../lib/settings.svelte';
  import { confirmAction, promptText, showToast } from '../lib/ui/dialogs.svelte';
  import { newId } from '../lib/db/schema';
  import type { CustomTag, ThemeSetting, UiLangSetting } from '../lib/types';

  function set<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    settings[key] = value;
    void saveSettings();
  }

  const LANGUAGES = $derived<{ value: UiLangSetting; label: string }[]>([
    { value: 'auto', label: t('settings.auto') },
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
    { value: 'ru', label: 'Русский' },
  ]);

  const FREQUENCIES = [2, 3, 4, 5];

  const THEMES = $derived<{ value: ThemeSetting; label: string }[]>([
    { value: 'auto', label: t('settings.auto') },
    { value: 'light', label: t('settings.theme.light') },
    { value: 'dark', label: t('settings.theme.dark') },
  ]);

  const REMINDERS = $derived<{ days: number; label: string }[]>([
    { days: 0, label: t('settings.backup.off') },
    { days: 7, label: tn('common.days', 7) },
    { days: 14, label: tn('common.days', 14) },
    { days: 30, label: tn('common.days', 30) },
  ]);

  function setReminder(days: number) {
    settings.backupEvery = days;
    settings.backupSnoozeUntil = 0;
    void saveSettings();
  }

  const workouts = live(() => db.workouts.where('status').equals('done').count());

  // ---------- Exercises the app doesn't suggest ----------

  const avoidedList = live(() => avoidedExercises());
  const avoided = $derived(
    (avoidedList.value ?? [])
      .map((exercise) => ({ exercise, name: nameOf(exercise) }))
      .sort((a, b) => a.name.localeCompare(b.name, locale())),
  );

  // ---------- Tags ----------

  function setTags(tags: CustomTag[]) {
    set('customTags', tags);
  }

  async function addTag() {
    const label = await promptText({ title: t('settings.tags.add'), placeholder: t('settings.tags.placeholder'), confirmLabel: t('common.add') });
    if (label) setTags([...settings.customTags, { id: `tag-${newId()}`, label, offDay: true }]);
  }

  async function renameTag(tag: CustomTag) {
    const label = await promptText({ title: t('settings.tags.rename'), value: tag.label, confirmLabel: t('common.save') });
    if (label) setTags(settings.customTags.map((c) => (c.id === tag.id ? { ...c, label } : c)));
  }

  function toggleOffDay(tag: CustomTag) {
    setTags(settings.customTags.map((c) => (c.id === tag.id ? { ...c, offDay: !c.offDay } : c)));
  }

  async function deleteTag(tag: CustomTag) {
    if (await confirmAction({ title: t('settings.tags.deleteConfirm', { tag: tag.label }), message: t('settings.tags.deleteText'), destructive: true })) {
      setTags(settings.customTags.filter((c) => c.id !== tag.id));
    }
  }

  // ---------- Backup ----------

  let fileInput = $state<HTMLInputElement>();
  let busy = $state(false);
  let copies = $state<SafetyCopy[]>([]);

  const refreshCopies = async () => {
    copies = await listCopies();
  };
  $effect(() => {
    void refreshCopies();
  });

  const fmtWhen = (ts: number) =>
    new Date(ts).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function backupNow() {
    busy = true;
    try {
      // runBackup toasts the outcome itself; a cancelled share sheet changes nothing.
      await runBackup();
    } finally {
      busy = false;
    }
  }

  async function afterRestore(dropped: number) {
    await loadSettings();
    await refreshCopies();
    showToast(dropped ? tn('settings.restore.doneDropped', dropped) : t('settings.restore.done'));
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let backup: BackupContents;
    try {
      backup = readBackup(await file.text());
    } catch (err) {
      showToast(t('settings.restore.unreadable', { error: (err as Error).message }));
      return;
    }
    const ok = await confirmAction({
      title: t('settings.restore.confirmTitle'),
      message: t('settings.restore.confirmMessage', { name: file.name }),
      confirmLabel: t('settings.restore.replace'),
      destructive: true,
    });
    if (!ok) return;
    busy = true;
    try {
      const { dropped } = await applyBackup(backup);
      await afterRestore(dropped);
    } catch (err) {
      showToast(t('settings.restore.failed', { error: (err as Error).message }));
    } finally {
      busy = false;
    }
  }

  async function restoreFromCopy(copy: SafetyCopy) {
    const ok = await confirmAction({
      title: t('settings.safety.confirmTitle'),
      message: t('settings.safety.confirmMessage', { date: fmtWhen(copy.createdAt) }),
      confirmLabel: t('settings.restore.replace'),
      destructive: true,
    });
    if (!ok) return;
    busy = true;
    try {
      await afterRestore(await restoreCopy(copy.id!));
    } catch (err) {
      showToast(t('settings.restore.failed', { error: (err as Error).message }));
    } finally {
      busy = false;
    }
  }

  // ---------- App ----------

  const iosInstallHint = showIOSInstallHint();

  async function installApp() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') showToast(t('settings.app.installing'));
  }
</script>

<div class="page">
  <Header title={t('settings.title')} />

  <section class="section">
    <h2 class="section-title">{t('settings.language.title')}</h2>
    <div class="stack">
      <div>
        <div class="label">{t('settings.language.interface')}</div>
        <div class="segmented full" role="radiogroup" aria-label={t('settings.language.interface')}>
          {#each LANGUAGES as lang (lang.value)}
            <button role="radio" aria-checked={settings.uiLang === lang.value} class:active={settings.uiLang === lang.value} onclick={() => set('uiLang', lang.value)}>{lang.label}</button>
          {/each}
        </div>
      </div>
      <div>
        <div class="label">{t('settings.language.exercises')}</div>
        <div class="segmented full" role="radiogroup" aria-label={t('settings.language.exercises')}>
          {#each LANGUAGES as lang (lang.value)}
            <button role="radio" aria-checked={settings.exerciseLang === lang.value} class:active={settings.exerciseLang === lang.value} onclick={() => set('exerciseLang', lang.value)}>{lang.label}</button>
          {/each}
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.theme.title')}</h2>
    <div class="segmented full" role="radiogroup" aria-label={t('settings.theme.title')}>
      {#each THEMES as theme (theme.value)}
        <button role="radio" aria-checked={settings.theme === theme.value} class:active={settings.theme === theme.value} onclick={() => set('theme', theme.value)}>{theme.label}</button>
      {/each}
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.body.title')}</h2>
    <div class="list">
      <a class="list-item" href="#/body">
        <span class="body grow"><span class="title">{t('settings.body.weight')}</span></span>
        <span class="muted">{settings.bodyWeightKg ? fmtKg(settings.bodyWeightKg) : t('settings.body.notSet')}</span>
        <Icon name="chevron" size={16} />
      </a>
    </div>
    <p class="hint small muted">{t('settings.body.hint')}</p>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.training.title')}</h2>
    <div class="field">
      <span class="label" id="frequency">{t('settings.training.frequency')}</span>
      <div class="segmented full" role="radiogroup" aria-labelledby="frequency">
        <button role="radio" aria-checked={settings.workoutsPerWeek === 0} class:active={settings.workoutsPerWeek === 0} onclick={() => set('workoutsPerWeek', 0)}>{t('settings.training.auto')}</button>
        {#each FREQUENCIES as n (n)}
          <button role="radio" aria-checked={settings.workoutsPerWeek === n} class:active={settings.workoutsPerWeek === n} onclick={() => set('workoutsPerWeek', n)}>{n}</button>
        {/each}
      </div>
    </div>
    <p class="hint small muted">{t('settings.training.hint')}</p>
    {#if avoided.length}
      <div class="label">{t('settings.avoided.title')}</div>
      <div class="list avoided">
        {#each avoided as { exercise, name } (exercise.id)}
          <div class="list-item static">
            <a class="grow avoided-name" href="#/exercise/{encodeURIComponent(exercise.id)}">{name}</a>
            <button class="btn avoided-btn" onclick={() => saveExerciseSettings(exercise.id, { avoid: undefined })}>{t('settings.avoided.restore')}</button>
          </div>
        {/each}
      </div>
      <p class="hint small muted">{t('settings.avoided.hint')}</p>
    {/if}
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.tags.title')}</h2>
    <p class="hint small muted">{t('settings.tags.hint')}</p>
    <div class="list">
      {#each settings.customTags as tag (tag.id)}
        <div class="list-item tag-row">
          <button type="button" class="tag-name" aria-label={t('settings.tags.rename')} onclick={() => renameTag(tag)}>{tag.label}</button>
          <label class="tag-off small muted">
            <input type="checkbox" checked={tag.offDay} onchange={() => toggleOffDay(tag)} />
            {t('settings.tags.offDay')}
          </label>
          <button type="button" class="icon-btn" aria-label={t('common.delete')} onclick={() => deleteTag(tag)}><Icon name="trash" size={18} /></button>
        </div>
      {/each}
      <button type="button" class="list-item" onclick={addTag}>
        <Icon name="plus" size={20} />
        <span class="body"><span class="title">{t('settings.tags.add')}</span></span>
      </button>
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.data.title')}</h2>
    <p class="hint small muted">{t('settings.data.note')}</p>
    <div class="list">
      {#if workouts.value}
        <div class="list-item static">
          <span class="accent"><Icon name="dumbbell" /></span>
          <span class="grow">{tn('common.workouts', workouts.value)}</span>
        </div>
      {/if}
      <button class="list-item" onclick={() => go('/import')}>
        <span class="accent"><Icon name="import" /></span>
        <span class="grow">{t('settings.data.import')}</span>
        <span class="muted"><Icon name="chevron" size={18} /></span>
      </button>
      <button class="list-item" disabled={busy} onclick={backupNow}>
        <span class="accent"><Icon name="share" /></span>
        <span class="grow">{t('settings.backup.now')}</span>
        <span class="muted small">{t('settings.backup.last', { when: lastBackupLabel(settings.lastBackupAt) })}</span>
      </button>
      <button class="list-item" disabled={busy} onclick={() => fileInput?.click()}>
        <span class="accent"><Icon name="refresh" /></span>
        <span class="grow">{t('settings.restore.action')}</span>
      </button>
    </div>
    <p class="hint small muted">{t('settings.backup.hint')}</p>
    <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={onFile} />

    <div class="label">{t('settings.backup.reminder')}</div>
    <div class="segmented full" role="radiogroup" aria-label={t('settings.backup.reminder')}>
      {#each REMINDERS as reminder (reminder.days)}
        <button role="radio" aria-checked={settings.backupEvery === reminder.days} class:active={settings.backupEvery === reminder.days} onclick={() => setReminder(reminder.days)}>{reminder.label}</button>
      {/each}
    </div>
  </section>

  {#if copies.length}
    <section class="section">
      <h2 class="section-title">{t('settings.safety.title')}</h2>
      <div class="list">
        {#each copies as copy (copy.id)}
          <div class="list-item static">
            <span class="grow copy">
              <span>{fmtWhen(copy.createdAt)}</span>
              <span class="muted small">{tn('common.workouts', copy.tables.workouts?.length ?? 0)}</span>
            </span>
            <button class="btn" disabled={busy} onclick={() => restoreFromCopy(copy)}>{t('settings.safety.restore')}</button>
          </div>
        {/each}
      </div>
      <p class="hint small muted">{t('settings.safety.hint', { n: KEEP_COPIES })}</p>
    </section>
  {/if}

  <section class="section">
    <h2 class="section-title">{t('settings.app.title')}</h2>
    {#if install.canInstall}
      <button class="btn btn-primary btn-block" onclick={installApp}>{t('settings.app.install')}</button>
    {/if}
    {#if iosInstallHint}
      <p class="hint small muted">{t('settings.app.iosHint')}</p>
    {/if}
    <p class="hint small muted">{t('settings.app.version', { version: `${version} · ${__BUILD__}` })}</p>
  </section>
</div>

<style>
  .hint {
    margin: 8px 4px 12px;
  }
  .full {
    width: 100%;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .accent {
    color: var(--accent);
    display: inline-flex;
  }
  .static {
    cursor: default;
  }
  .static:active {
    background: none;
  }
  .copy {
    display: flex;
    flex-direction: column;
  }
  .avoided {
    margin-top: 4px;
  }
  .avoided-name {
    color: inherit;
    font-weight: 600;
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .avoided-btn {
    flex-shrink: 0;
    min-height: 36px;
    padding: 4px 10px;
  }
  .tag-row {
    gap: 8px;
  }
  .tag-name {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    text-align: left;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .tag-off {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
</style>
