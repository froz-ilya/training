<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import BodyBalance from '../components/progress/BodyBalance.svelte';
  import BodyWeightCard from '../components/progress/BodyWeightCard.svelte';
  import ExerciseStatusList from '../components/progress/ExerciseStatusList.svelte';
  import TrainingCalendar from '../components/progress/TrainingCalendar.svelte';
  import TrendPill from '../components/progress/TrendPill.svelte';
  import WeeklyBars from '../components/progress/WeeklyBars.svelte';
  import { loadProgress, syncStallOutcomes } from '../lib/coach/data';
  import { statusLists, type Count } from '../lib/coach/overview';
  import { fmtSet } from '../lib/coach/text';
  import { fmtDate, daysBetween, toISODate } from '../lib/dates';
  import { nameOf } from '../lib/exercises.svelte';
  import { fmtNumber, t, tn } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { onMount } from 'svelte';

  /** Rows of a short list before "Show all". */
  const SHORT_LIST = 3;

  const data = live(loadProgress);
  onMount(() => void syncStallOutcomes());

  const today = toISODate();

  let allAttention = $state(false);
  let allBests = $state(false);

  const attention = $derived(
    statusLists(data.value?.views ?? [], today).find((list) => list.heading === 'attention')?.items ?? [],
  );
  const bests = $derived(data.value?.bests ?? []);
  const tiles = $derived.by((): { label: string; count: Count }[] => {
    const overview = data.value?.overview;
    if (!overview) return [];
    return [
      { label: t('progress.tile.workouts'), count: overview.workouts },
      { label: t('progress.tile.sets'), count: overview.sets },
      { label: t('progress.tile.bests'), count: overview.bests },
    ];
  });
  /** The bars compare groups with each other, so the biggest fills its track. */
  const mostSets = $derived(Math.max(1, ...(data.value?.groups ?? []).map((g) => g.recentSets)));

  function lastTrained(date: string): string {
    const days = daysBetween(date, today);
    if (days <= 0) return t('progress.today');
    return days === 1 ? t('progress.yesterday') : tn('progress.daysAgo', days);
  }

  function change({ current, previous }: Count): string {
    const delta = current - previous;
    if (!delta) return '±0';
    return delta > 0 ? `+${fmtNumber(delta)}` : `−${fmtNumber(-delta)}`;
  }
</script>

<div class="page">
  <Header title={t('shell.tab.progress')} />

  {#if !data.value}
    <Skeleton />
  {:else if !data.value.workouts}
    <div class="empty">
      <p>{t('progress.empty')}</p>
      <a class="btn" href="#/import">{t('progress.emptyAction')}</a>
    </div>
    <BodyWeightCard />
  {:else}
    <div class="content-in">
      <div class="section first">
        <div class="section-title">{t('progress.body')}</div>
        <BodyBalance load={data.value.body} />
      </div>

      <div class="section">
        <div class="section-title">{t('progress.overview')}</div>
        <div class="tiles">
          {#each tiles as tile (tile.label)}
            <div class="card tile">
              <b>{fmtNumber(tile.count.current)}</b>
              <span class="name">{tile.label}</span>
              <span class="delta">{change(tile.count)}</span>
            </div>
          {/each}
        </div>
        <p class="muted small note">{t('progress.overviewNote')}</p>
      </div>

      <BodyWeightCard />

      {#if data.value.groups.length}
        <div class="section">
          <div class="section-title">{t('progress.groups')}</div>
          <div class="list">
            {#each data.value.groups as row (row.group)}
              <a class="list-item group-row" href="#/group/{row.group}">
                <span class="body">
                  <span class="head">
                    <span class="title">{t(`exercises.group.${row.group}`)}</span>
                    {#if row.trend !== null}<TrendPill change={row.trend} />{/if}
                  </span>
                  <span class="bar" aria-hidden="true"><i style:width="{(row.recentSets / mostSets) * 100}%"></i></span>
                  <span class="sub">{lastTrained(row.lastDate)} · {tn('common.sets', row.recentSets)}</span>
                </span>
                <span class="go"><Icon name="chevron" size={16} /></span>
              </a>
            {/each}
          </div>
          <p class="muted small note">{t('progress.groupsNote')}</p>
        </div>
      {/if}

      {#if attention.length}
        <div class="section">
          <div class="section-title">{t('progress.attention')}</div>
          <ExerciseStatusList items={allAttention ? attention : attention.slice(0, SHORT_LIST)} />
          {#if !allAttention && attention.length > SHORT_LIST}
            <button class="btn btn-ghost btn-block more" onclick={() => (allAttention = true)}>
              {t('exercise.all', { n: attention.length })}
            </button>
          {/if}
        </div>
      {/if}

      {#if bests.length}
        <div class="section">
          <div class="section-title">{t('progress.records')}</div>
          <div class="list">
            {#each allBests ? bests : bests.slice(0, SHORT_LIST) as best (best.exercise.id + best.date)}
              <a class="list-item" href="#/exercise/{best.exercise.id}">
                <span class="badge-icon"><Icon name="trophy" /></span>
                <span class="body">
                  <span class="title">{nameOf(best.exercise)}</span>
                  <span class="sub">{fmtSet(best.set, best.exercise.load)} · {fmtDate(best.date)}</span>
                </span>
                <span class="muted small">{t('progress.recordGain', { percent: fmtNumber(Math.round(best.gain * 100)) })}</span>
              </a>
            {/each}
          </div>
          {#if !allBests && bests.length > SHORT_LIST}
            <button class="btn btn-ghost btn-block more" onclick={() => (allBests = true)}>
              {t('exercise.all', { n: bests.length })}
            </button>
          {/if}
        </div>
      {/if}

      <div class="section">
        <div class="section-title">{t('progress.calendar')}</div>
        <div class="card">
          <p class="muted small summary">
            {t('progress.calendarSummary', { workouts: tn('common.workouts', data.value.workoutsInCalendar) })}
          </p>
          <TrainingCalendar weeks={data.value.calendar} />
        </div>
      </div>

      <div class="section">
        <div class="section-title">{t('progress.volume')}</div>
        <div class="card"><WeeklyBars weeks={data.value.weeks} /></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .first {
    margin-top: 8px;
  }
  .summary {
    margin: 0 0 10px;
  }
  .note {
    margin: 8px 4px 0;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px;
  }
  .tile b {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 800;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }
  .tile .name {
    flex: 1;
    font-size: 13px;
    line-height: 1.25;
    color: var(--text-2);
    overflow-wrap: break-word;
  }
  /* The longest labels ("Arbeitssätze") take a whole line in a third of a small phone. */
  @media (max-width: 359px) {
    .tile {
      padding: 12px 8px;
    }
    .tile .name {
      font-size: 12px;
    }
  }
  .delta {
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .group-row {
    gap: 8px;
    padding-right: 10px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .bar {
    display: block;
    height: 6px;
    margin: 6px 0 4px;
    border-radius: 3px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent-bar);
  }
  .go {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--faint);
  }
  .more {
    margin-top: 8px;
  }
</style>
