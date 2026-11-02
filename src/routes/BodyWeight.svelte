<script lang="ts">
  import Header from '../components/Header.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import TrendChart, { type TrendPoint } from '../components/progress/TrendChart.svelte';
  import { parseBodyKg, removeBodyWeight, saveBodyWeight, weightChangeText } from '../lib/bodyWeight';
  import { fmtKg } from '../lib/coach/text';
  import { fmtDate, toISODate } from '../lib/dates';
  import { db } from '../lib/db/schema';
  import { fmtNumber, t } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { showToast } from '../lib/ui/dialogs.svelte';
  import type { BodyWeight } from '../lib/types';

  const log = live(() => db.bodyWeights.orderBy('date').toArray());
  const entries = $derived(log.value ?? []);
  const newestFirst = $derived([...entries].reverse());
  const latest = $derived(entries[entries.length - 1]);
  const points = $derived(entries.map((e): TrendPoint => ({ date: e.date, value: e.kg, label: fmtKg(e.kg) })));

  const today = toISODate();
  let open = $state(false);
  /** The weigh-in being changed; null when adding one. */
  let editing = $state<BodyWeight | null>(null);
  let weight = $state('');
  let date = $state(today);

  const kg = $derived(parseBodyKg(weight));
  const canSave = $derived(kg !== null && !!date && date <= today);

  function add() {
    editing = null;
    weight = '';
    date = today;
    open = true;
  }

  function edit(entry: BodyWeight) {
    editing = entry;
    weight = fmtNumber(entry.kg);
    date = entry.date;
    open = true;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (kg === null || !canSave) return;
    try {
      await saveBodyWeight({ date, kg }, editing?.date);
      open = false;
    } catch (err) {
      console.error(err);
      showToast(t('workout.saveFailed'));
    }
  }

  async function remove() {
    if (!editing) return;
    const entry = $state.snapshot(editing);
    open = false;
    await removeBodyWeight(entry.date);
    showToast(t('progress.weight.removed'), { actionLabel: t('common.undo'), onAction: () => void saveBodyWeight(entry) });
  }
</script>

<div class="page">
  <Header title={t('progress.weight')} backTo="/progress" />

  {#if !log.value}
    <Skeleton />
  {:else if !latest}
    <div class="empty">
      <p>{t('progress.weight.empty')}</p>
      <button class="btn btn-primary" onclick={add}>{t('progress.weight.log')}</button>
    </div>
  {:else}
    <div class="content-in">
      <div class="card now">
        <b>{fmtKg(latest.kg)}</b>
        <span class="muted small">{fmtDate(latest.date)}</span>
        {#if entries.length >= 2}<span class="small">{weightChangeText(entries)}</span>{/if}
      </div>

      <button class="btn btn-primary btn-block log" onclick={add}>{t('progress.weight.log')}</button>

      {#if points.length >= 2}
        <div class="section">
          <div class="card">
            <TrendChart
              {points}
              lineLabel={t('progress.weight')}
              format={(value) => fmtNumber(value)}
              summary={t('progress.weight.chartSummary', { value: fmtKg(latest.kg) })}
            />
          </div>
        </div>
      {/if}

      <div class="section">
        <div class="section-title">{t('progress.weight.history')}</div>
        <div class="list">
          {#each newestFirst as entry (entry.date)}
            <button class="list-item" onclick={() => edit(entry)}>
              <span class="grow">{fmtDate(entry.date)}</span>
              <b>{fmtKg(entry.kg)}</b>
            </button>
          {/each}
        </div>
        <p class="muted small note">{t('progress.weight.note')}</p>
      </div>
    </div>
  {/if}
</div>

<Sheet bind:open title={editing ? t('progress.weight.edit') : t('progress.weight.log')}>
  <form class="stack" onsubmit={save}>
    <label class="field">
      <span class="label">{t('progress.weight.label')}</span>
      <input class="input" type="text" inputmode="decimal" autocomplete="off" placeholder={latest ? fmtNumber(latest.kg) : ''} bind:value={weight} {@attach (el) => el.focus()} />
    </label>
    <label class="field">
      <span class="label">{t('workout.date')}</span>
      <input class="input" type="date" max={today} bind:value={date} />
    </label>
    <button class="btn btn-primary btn-block" type="submit" disabled={!canSave}>{t('common.save')}</button>
    {#if editing}
      <button class="btn btn-ghost btn-block" type="button" onclick={remove}>{t('common.delete')}</button>
    {/if}
  </form>
</Sheet>

<style>
  .now {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 8px;
  }
  .now b {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 800;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }
  .log {
    margin-top: 12px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .list-item b {
    font-variant-numeric: tabular-nums;
  }
  .note {
    margin: 8px 4px 0;
  }
</style>
