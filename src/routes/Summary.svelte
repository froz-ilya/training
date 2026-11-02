<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { percentValue } from '../components/workout/display';
  import { loadWorkoutSummary, type SummaryExercise } from '../lib/coach/data';
  import { fmtSet } from '../lib/coach/text';
  import { fmtDate } from '../lib/dates';
  import { nameOf } from '../lib/exercises.svelte';
  import { fmtNumber, t } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { back, replace, route } from '../lib/router.svelte';
  import { fmtMinutes, summarizeSets } from '../lib/workout/format';
  import { workoutTitle } from '../lib/workout/title';

  const id = route.parts[1] ?? '';
  /** A workout just finished is over, wherever it was started from, so Done goes home. */
  const justFinished = route.query.has('finished');
  const data = live(() => loadWorkoutSummary(id));
  const summary = $derived(data.value ?? null);

  const tiles = $derived.by((): { label: string; value: string }[] => {
    if (!summary) return [];
    return [
      ...(summary.minutes === null ? [] : [{ label: t('workout.summary.time'), value: fmtMinutes(summary.minutes) }]),
      { label: t('progress.tile.sets'), value: fmtNumber(summary.workSets) },
      { label: t('progress.tile.bests'), value: fmtNumber(summary.bests.length) },
    ];
  });

  /** The change since last time, in words, so colour is never the only signal. */
  function changeText({ sets, first, restarted, comparison, offDay }: SummaryExercise): string {
    if (sets.every((s) => s.kind === 'warmup')) return t('workout.warmups');
    if (first) return t('workout.firstTime');
    if (restarted) return t('exercise.chart.change');
    if (!comparison) return '';
    const percent = percentValue(comparison.percent);
    if (comparison.trend === 'up') return comparison.percent > 0 ? t('workout.trendUp', { percent }) : t('workout.summary.moreReps');
    if (comparison.trend === 'down') return t('workout.trendDown', { percent });
    if (comparison.trend === 'same') return t('workout.trendSame');
    return t(offDay ? 'workout.summary.offDay' : 'workout.trendExpected', { percent });
  }
</script>

<div class="page">
  {#if data.value === undefined}
    <Header title={t('workout.summary')} backTo="/" />
    <Skeleton lines={5} />
  {:else if !summary}
    <Header title={t('workout.summary')} backTo="/" />
    <p class="empty">{t('workout.notFound')}</p>
  {:else}
    <Header title={t('workout.summary')} subtitle="{workoutTitle(summary.groups)} · {fmtDate(summary.workout.date)}" backTo="/" />

    <div class="content-in">
      <div class="tiles" style:--tiles={tiles.length}>
        {#each tiles as tile (tile.label)}
          <div class="card tile">
            <b>{tile.value}</b>
            <span class="name">{tile.label}</span>
          </div>
        {/each}
      </div>

      {#if summary.bests.length}
        <div class="section">
          <h2 class="section-title">{t('progress.tile.bests')}</h2>
          <div class="list">
            {#each summary.bests as best (best.exercise.id)}
              <a class="list-item" href="#/exercise/{encodeURIComponent(best.exercise.id)}">
                <span class="badge-icon"><Icon name="trophy" /></span>
                <span class="body">
                  <span class="title">{nameOf(best.exercise)}</span>
                  <span class="sub">{fmtSet(best.set, best.exercise.load)}</span>
                </span>
                <span class="muted small">{t('progress.recordGain', { percent: fmtNumber(Math.round(best.gain * 100)) })}</span>
              </a>
            {/each}
          </div>
        </div>
      {/if}

      <div class="section">
        <h2 class="section-title">{t('workout.summary.exercises')}</h2>
        <div class="list">
          {#each summary.exercises as row (row.entry)}
            {@const text = changeText(row)}
            {@const trend = row.comparison?.trend}
            <svelte:element this={row.exercise ? 'a' : 'div'} class="list-item" class:static={!row.exercise} href={row.exercise ? `#/exercise/${encodeURIComponent(row.exerciseId)}` : undefined}>
              <span class="body">
                <span class="title">{row.exercise ? nameOf(row.exercise) : t('workout.unknownExercise')}</span>
                <span class="sub">{summarizeSets(row.sets, row.exercise?.load ?? 'weight')}</span>
                {#if text}<span class="sub change" class:up={trend === 'up'} class:down={trend === 'down'}>{text}</span>{/if}
              </span>
            </svelte:element>
          {/each}
        </div>
      </div>

      <button class="btn btn-primary btn-block done" onclick={() => (justFinished ? replace('/') : back('/'))}>{t('common.done')}</button>
    </div>
  {/if}
</div>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(var(--tiles), minmax(0, 1fr));
    gap: 8px;
    margin-top: 8px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px;
  }
  .tile b {
    font-family: var(--font-display);
    font-size: 22px;
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
    .tile b {
      font-size: 20px;
    }
    .tile .name {
      font-size: 12px;
    }
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .change.up {
    color: var(--good-strong);
  }
  .change.down {
    color: var(--bad-strong);
  }
  .static {
    cursor: default;
  }
  .static:active {
    background: none;
  }
  .done {
    margin-top: 16px;
  }
</style>
