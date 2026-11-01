<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import { importHistory, listDays, type ImportResult } from '../lib/db/backup';
  import { FileError, HISTORY_EXAMPLE } from '../lib/db/historyFile';
  import { t, tn } from '../lib/i18n.svelte';
  import { go } from '../lib/router.svelte';
  import { showToast } from '../lib/ui/dialogs.svelte';

  let busy = $state(false);
  let error = $state('');
  let result = $state<ImportResult | null>(null);

  const example = JSON.stringify(HISTORY_EXAMPLE, null, 2);

  async function copyExample() {
    try {
      await navigator.clipboard.writeText(example);
      showToast(t('import.format.copied'));
    } catch {
      showToast(t('import.format.copyFailed'));
    }
  }

  async function readFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    busy = true;
    error = '';
    try {
      const text = await file.text().catch(() => {
        throw new FileError(t('import.failed'));
      });
      result = await importHistory(text);
    } catch (err) {
      // Anything but a FileError came from the database: the user can't act on its wording.
      if (err instanceof FileError) error = err.message;
      else {
        console.error(err);
        error = t('import.saveFailed');
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="page">
  <Header title={t('import.title')} backTo="/settings" />

  {#if result}
    <div class="card done">
      <span class="badge-icon"><Icon name="check" /></span>
      <h2>{t('import.done.title')}</h2>
      <p>{tn('import.done.workouts', result.workouts)}</p>
      <p class="muted small">{tn('import.done.sets', result.sets)}</p>
      {#if result.customExercises}<p class="muted small">{tn('import.done.custom', result.customExercises)}</p>{/if}
      {#if result.notes}<p class="muted small">{tn('import.done.notes', result.notes)}</p>{/if}
      {#if result.skippedDays.same.length}
        <p class="muted small">{tn('import.done.skipped', result.skippedDays.same.length, { days: listDays(result.skippedDays.same) })}</p>
      {/if}
      {#if result.skippedDays.other.length}
        <p class="muted small">{tn('import.done.skippedOther', result.skippedDays.other.length, { days: listDays(result.skippedDays.other) })}</p>
      {/if}
      {#if result.skippedDays.active.length}
        <p class="muted small">{tn('import.done.skippedActive', result.skippedDays.active.length, { days: listDays(result.skippedDays.active) })}</p>
      {/if}
      {#if result.dropped}<p class="muted small">{tn('import.done.dropped', result.dropped)}</p>{/if}
    </div>
    <div class="section stack">
      <button class="btn btn-primary btn-block" onclick={() => go('/history')}>{t('import.done.history')}</button>
      <button class="btn btn-block" onclick={() => (result = null)}>{t('import.done.more')}</button>
    </div>
  {:else}
    <p class="muted intro">{t('import.intro')}</p>
    <div class="card stack">
      <h2>{t('import.file.title')}</h2>
      <p class="muted small">{t('import.file.hint')}</p>
      <label class="btn btn-primary btn-block" class:disabled={busy}>
        <Icon name="import" size={20} />
        {busy ? t('import.file.reading') : t('import.file.pick')}
        <input class="hidden" type="file" accept=".json,application/json" disabled={busy} onchange={readFile} />
      </label>
      {#if error}<p class="bad small" role="alert">{error}</p>{/if}
    </div>

    <details class="card format">
      <summary>{t('import.format.title')}</summary>
      <p class="muted small">{t('import.format.intro')}</p>
      <ul class="muted small">
        <li>{t('import.format.date')}</li>
        <li>{t('import.format.exercise')}</li>
        <li>{t('import.format.sets')}</li>
        <li>{t('import.format.optional')}</li>
        <li>{t('import.format.repeat')}</li>
      </ul>
      <pre data-no-edge-swipe>{example}</pre>
      <button class="btn btn-block" onclick={copyExample}>{t('import.format.copy')}</button>
    </details>
  {/if}
</div>

<style>
  h2 {
    font-size: 20px;
    font-weight: 800;
  }
  .intro {
    margin-bottom: 16px;
  }
  .hidden {
    display: none;
  }
  .disabled {
    opacity: 0.6;
  }
  .format {
    margin-top: 12px;
  }
  summary {
    font-weight: 800;
    cursor: pointer;
  }
  .format p {
    margin-top: 10px;
  }
  ul {
    margin: 8px 0 12px;
    padding-left: 18px;
  }
  li + li {
    margin-top: 4px;
  }
  pre {
    margin: 0 0 12px;
    padding: 10px;
    max-height: 320px;
    overflow: auto;
    border-radius: var(--radius-xs);
    background: var(--inset-bg);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.45;
  }
  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }
</style>
