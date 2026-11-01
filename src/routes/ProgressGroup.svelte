<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import ExerciseStatusList from '../components/progress/ExerciseStatusList.svelte';
  import TrendPill from '../components/progress/TrendPill.svelte';
  import WeeklyBars from '../components/progress/WeeklyBars.svelte';
  import { groupOf, MUSCLE_GROUPS } from '../lib/catalog/groups';
  import { loadProgress, syncStallOutcomes } from '../lib/coach/data';
  import { statusLists } from '../lib/coach/overview';
  import { toISODate } from '../lib/dates';
  import { t } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { route } from '../lib/router.svelte';

  const id = route.parts[1] ?? '';
  const group = MUSCLE_GROUPS.find((g) => g === id);

  const data = live(loadProgress);
  onMount(() => void syncStallOutcomes());

  const today = toISODate();
  const summary = $derived(data.value?.groups.find((g) => g.group === group));
  const lists = $derived(statusLists((data.value?.views ?? []).filter((v) => groupOf(v.exercise.muscle) === group), today));
  const older = $derived(lists.find((list) => list.heading === 'older'));
  const current = $derived(lists.filter((list) => list.heading !== 'older'));
</script>

<div class="page">
  {#if !group}
    <Header title="" backTo="/progress" />
    <p class="empty">{t('progress.group.notFound')}</p>
  {:else}
    <Header title={t(`exercises.group.${group}`)} backTo="/progress" />

    {#if !data.value}
      <Skeleton />
    {:else if !summary}
      <p class="empty">{t('progress.group.empty')}</p>
    {:else}
      <div class="content-in">
        <div class="card trend first">
          <div class="trend-head">
            <span class="trend-title">{t('progress.group.trend')}</span>
            {#if summary.trend !== null}<TrendPill change={summary.trend} />{/if}
          </div>
          <p class="muted small">
            {summary.trend === null ? t('progress.group.noTrend') : t('progress.group.trendText', { n: summary.compared })}
          </p>
        </div>

        <div class="section">
          <div class="section-title">{t('progress.volume')}</div>
          <div class="card"><WeeklyBars weeks={summary.weeks} /></div>
        </div>

        {#each current as list (list.heading)}
          <div class="section">
            <div class="section-title">{t(`progress.${list.heading}`)}</div>
            <ExerciseStatusList items={list.items} />
          </div>
        {/each}

        {#if older}
          <details class="section">
            <summary class="section-title">
              {t('progress.older')}
              <span class="count">{older.items.length}<Icon name="chevron" size={14} /></span>
            </summary>
            <ExerciseStatusList items={older.items} />
          </details>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .first {
    margin-top: 8px;
  }
  .trend {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .trend p {
    margin: 0;
  }
  .trend-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .trend-title {
    font-weight: 600;
  }
  summary {
    cursor: pointer;
    list-style: none;
    min-height: 44px;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .count {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .count :global(svg) {
    transition: transform var(--dur-fast) var(--ease);
  }
  details[open] .count :global(svg) {
    transform: rotate(90deg);
  }
</style>
