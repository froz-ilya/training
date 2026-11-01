<script lang="ts">
  import { liveQuery } from 'dexie';
  import { untrack } from 'svelte';
  import Icon from '../Icon.svelte';
  import SetRow from './SetRow.svelte';
  import NoteChips from '../notes/NoteChips.svelte';
  import SetSuggestion from '../coach/SetSuggestion.svelte';
  import { compareExercise, compareSet, pairSets } from '../../lib/coach/compare';
  import { loadPriorWork, type PriorWorkPair } from '../../lib/coach/data';
  import { earlierWorkText } from '../../lib/coach/text';
  import { fmtDate, toISODate } from '../../lib/dates';
  import { collapse, reducedMotion } from '../../lib/motion';
  import { nameOf } from '../../lib/exercises.svelte';
  import { t } from '../../lib/i18n.svelte';
  import { fmtCompact, percentValue, weightHeading } from './display';
  import type { Performance } from '../../lib/db/repo';
  import type { Suggestion } from '../../lib/coach/suggest';
  import type { Entry } from '../../lib/workout/entries';
  import type { Exercise, ExerciseNote, ExerciseSettings, WorkoutSet } from '../../lib/types';

  let {
    entry,
    exercise,
    settings,
    last,
    position,
    previousName,
    cost,
    body,
    checkable,
    openSetId,
    onselect,
    oncheck,
    onaddset,
    onmenu,
    onmachine,
    onsuggest,
    notes,
    offDay,
    onnote,
  }: {
    entry: Entry;
    exercise: Exercise | undefined;
    settings: ExerciseSettings | undefined;
    /** Undefined until loaded, null when there's no earlier workout with this exercise. */
    last: Performance | null | undefined;
    /** Where this exercise comes in the workout, from 1. */
    position: number;
    /** The exercise done just before this one. */
    previousName: string | null;
    /** How much strength each position later usually costs. */
    cost: number;
    /** Body weight used to compare bodyweight exercises. */
    body: number;
    checkable: boolean;
    openSetId: string | null;
    onselect: (set: WorkoutSet) => void;
    oncheck: (set: WorkoutSet) => void;
    onaddset: () => void;
    onmenu: () => void;
    onmachine: () => void;
    /** Given while the workout can still change: applying fills in the unfinished sets. */
    onsuggest?: (suggestion: Suggestion) => void;
    /** Comments on this exercise in this workout. */
    notes: ExerciseNote[];
    /** A tag says today doesn't reflect the exercise, so a dip isn't shown as a loss. */
    offDay: boolean;
    /** Opens the comment sheet, for one set when given. */
    onnote: (set?: WorkoutSet) => void;
  } = $props();

  const load = $derived(exercise?.load ?? 'weight');
  const levels = $derived(!!exercise?.levels);
  const paired = $derived(pairSets(entry.sets, last?.sets ?? []));
  const previousOf = (set: WorkoutSet) => paired[entry.sets.indexOf(set)];

  const warmups = $derived(entry.sets.filter((s) => s.kind === 'warmup'));
  const workSets = $derived(entry.sets.filter((s) => s.kind === 'work'));

  /** Earlier work for this exercise's muscles, which follows today's sets as they're ticked. */
  let prior = $state<PriorWorkPair | null>(null);
  const workoutId = $derived(entry.sets[0]?.workoutId);
  const entryNumber = $derived(entry.entry);
  const exerciseId = $derived(entry.exerciseId);
  const lastWorkoutId = $derived(last?.workoutId);

  $effect(() => {
    const [today, card, id, previous] = [workoutId, entryNumber, exerciseId, lastWorkoutId];
    prior = null;
    if (!today || !previous) return;
    const sub = liveQuery(() => loadPriorWork(id, today, card, previous)).subscribe({
      next: (value) => (prior = value),
      error: (e) => console.error(e),
    });
    return () => sub.unsubscribe();
  });

  /** Done work sets against the same sets last time; nothing until the first one is done. */
  const trend = $derived.by(() => {
    if (!last) return null;
    const done = workSets.filter((s) => s.done);
    const before = done.map(previousOf).filter((s) => s !== undefined);
    if (!done.length || !before.length) return null;
    return compareExercise(done, before, {
      position,
      previousPosition: last.position,
      cost,
      load,
      bodyKg: body,
      offDay,
      priorWork: prior?.today,
      previousPriorWork: prior?.previous,
    });
  });
  const calm = $derived(trend?.trend === 'expected');

  /** A comment whose set is gone stays with the exercise. */
  const onSet = (note: ExerciseNote) => entry.sets.some((s) => s.id === note.setId);
  const cardNotes = $derived(notes.filter((n) => !onSet(n)));

  const moved = $derived(!!last && last.position !== position);
  const later = $derived(!!last && position > last.position);

  /** The heading shows what's being read during a workout; warm-ups stay one tap away. */
  let warmupsChoice = $state<boolean | null>(null);
  const warmupsShown = $derived(
    warmups.some((s) => s.id === openSetId) || (warmupsChoice ?? (checkable && warmups.some((s) => !s.done))),
  );

  /** A new row opens from no height, so it needs scrolling into view again once it's full size. */
  function keepSelectedInView(e: Event) {
    if (!openSetId) return;
    (e.currentTarget as HTMLElement)
      .querySelector(`[data-set="${CSS.escape(openSetId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function toggleWarmups() {
    const shown = warmupsShown;
    untrack(() => (warmupsChoice = !shown));
  }

  /** Work sets are numbered 1, 2, 3; warm-ups sit outside the count. */
  const workNumber = (set: WorkoutSet) => workSets.indexOf(set) + 1;

  /** Without its year, a session from last year reads like a date still to come. */
  const lastDate = (date: string) =>
    date.startsWith(toISODate().slice(0, 4)) ? fmtDate(date, { day: 'numeric', month: 'short' }) : fmtDate(date);
</script>

{#snippet row(set: WorkoutSet)}
  {@const previous = previousOf(set)}
  {@const own = notes.filter((n) => n.setId === set.id)}
  <div class="set-slot" transition:collapse onintroend={keepSelectedInView}>
    <SetRow
      {set}
      number={workNumber(set)}
      {previous}
      change={compareSet(set, previous, { load, bodyKg: body })}
      {calm}
      {load}
      {checkable}
      selected={openSetId === set.id}
      onselect={() => onselect(set)}
      oncheck={() => oncheck(set)}
    />
    {#if own.length}
      <div class="set-notes" transition:collapse><NoteChips notes={own} onedit={() => onnote(set)} /></div>
    {/if}
  </div>
{/snippet}

<section class="card exercise">
  <header class="head">
    <span class="position">{position}</span>
    <h2>
      {#if exercise}
        <a href="#/exercise/{encodeURIComponent(entry.exerciseId)}">{nameOf(exercise)}</a>
      {:else}
        {t('workout.unknownExercise')}
      {/if}
    </h2>
    {#if trend}
      {@const percent = percentValue(trend.percent)}
      {#if trend.trend === 'up'}
        <span class="trend up" aria-label={t('workout.trendUp', { percent })}><span aria-hidden="true">▲</span> +{percent}%</span>
      {:else if trend.trend === 'down'}
        <span class="trend down" aria-label={t('workout.trendDown', { percent })}><span aria-hidden="true">▼</span> −{percent}%</span>
      {:else if trend.trend === 'expected'}
        <span class="trend expected" aria-label={t('workout.trendExpected', { percent })}>
          <span aria-hidden="true">≈</span> {t('workout.expectedShort', { percent: `−${percent}` })}
        </span>
      {:else}
        <span class="trend same" aria-label={t('workout.trendSame')}><span aria-hidden="true">=</span></span>
      {/if}
    {/if}
    <button type="button" class="icon-btn menu" aria-label={t('workout.more')} onclick={onmenu}><Icon name="more" size={20} /></button>
  </header>

  <p class="context">
    {#if last}
      {t('workout.lastDate', { date: lastDate(last.date) })}
    {:else if last === null}
      {t('workout.firstTime')}
    {/if}
    {#if previousName}<span class="sep">·</span> {t('workout.afterExercise', { name: previousName })}{/if}
    {#if settings?.machineSetting}
      <span class="sep">·</span>
      <button type="button" class="machine" onclick={onmachine}>{settings.machineSetting}</button>
    {/if}
  </p>
  {#if cardNotes.length}
    <div class="card-notes" transition:collapse><NoteChips notes={cardNotes} onedit={() => onnote()} /></div>
  {/if}
  {#if moved && last}
    <p class="context order">
      {t('workout.orderChanged', { now: String(position), then: String(last.position) })}{#if later}. {t('workout.laterNote')}{/if}
    </p>
  {/if}
  {#if trend?.fatigued}
    <p class="context">{earlierWorkText(trend.fatigued)}</p>
  {/if}

  {#if onsuggest}
    {#key `${entry.exerciseId}:${position}`}
      <SetSuggestion exerciseId={entry.exerciseId} {position} onapply={onsuggest} />
    {/key}
  {/if}

  <div class="sets" class:time={load === 'time'} class:checkable class:levels>
    <div class="columns" aria-hidden="true">
      <span>{t('workout.col.set')}</span>
      <span>{t('workout.col.last')}</span>
      {#if load === 'time'}
        <span class="num">{t('workout.col.time')}</span>
      {:else}
        <span class="num">{weightHeading(entry.sets, load, levels)}</span>
        <span class="num">{t('workout.col.reps')}</span>
      {/if}
    </div>

    {#if warmups.length}
      <div class="warmups">
        <button type="button" class="warmups-toggle" aria-expanded={warmupsShown} onclick={toggleWarmups}>
          <span class="chevron" class:open={warmupsShown}><Icon name="chevron" size={14} /></span>
          <span class="warmups-text">
            <b>{t('workout.warmups')}</b>
            {#if !warmupsShown}· {warmups.map((s) => fmtCompact(s, load)).join(', ')}{/if}
          </span>
          <span class="sr">{warmupsShown ? t('workout.hideWarmups') : t('workout.showWarmups')}</span>
        </button>
        {#if warmupsShown}
          <div transition:collapse onintroend={keepSelectedInView}>
            {#each warmups as set (set.id)}
              {@render row(set)}
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#each workSets as set (set.id)}
      {@render row(set)}
    {/each}
  </div>
  {#if entry.sets.some((s) => s.failure)}<p class="context legend">{t('exercise.failureLegend')}</p>{/if}

  <div class="foot">
    <button type="button" class="add" onclick={onaddset}>
      <Icon name="plus" size={16} />
      {t('workout.addSet')}
    </button>
    <button type="button" class="add comment" aria-label={t('notes.title.exercise')} onclick={() => onnote()}>
      <Icon name="comment" size={16} />
      {t('notes.add')}
    </button>
  </div>
</section>

<style>
  .exercise {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px 4px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .position {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 7px;
    background: var(--accent-soft);
    color: var(--accent);
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 800;
  }
  h2 {
    flex: 1;
    min-width: 0;
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
    line-height: 1.2;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  h2 a {
    color: inherit;
    text-decoration: none;
  }
  .trend {
    flex-shrink: 0;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .trend.up {
    color: var(--good-strong);
  }
  .trend.down {
    color: var(--bad-strong);
  }
  .trend.expected {
    color: var(--text-2);
  }
  .menu {
    margin: -4px -8px -4px -4px;
  }
  .context {
    font-size: 12.5px;
    line-height: 1.3;
    color: var(--muted);
  }
  .sep {
    margin: 0 2px;
  }
  .machine {
    padding: 12px 4px;
    margin: -12px -4px;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .legend {
    margin: 2px 4px 0;
  }
  .sets {
    --set-gap: 6px;
    --set-columns: 22px minmax(0, 1.35fr) minmax(0, 1fr) minmax(0, 0.85fr);
    margin-top: 4px;
  }
  .sets.time {
    --set-columns: 22px minmax(0, 1.5fr) minmax(0, 1.7fr);
  }
  /* The dock has a second row of steppers here. */
  .sets.levels {
    --dock-clear: 266px;
  }
  .columns {
    display: grid;
    grid-template-columns: var(--set-columns);
    gap: var(--set-gap);
    padding: 0 4px 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }
  .sets.checkable .columns {
    padding-right: 50px;
  }
  .num {
    text-align: center;
  }
  .warmups {
    margin-bottom: 3px;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--hairline);
  }
  .warmups-toggle {
    position: relative;
    width: 100%;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }
  .warmups-text {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .warmups-text b {
    font-weight: 600;
  }
  .chevron {
    flex-shrink: 0;
    display: grid;
    transition: transform var(--dur) var(--ease);
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .foot {
    display: flex;
    justify-content: space-between;
  }
  /* Padding rather than a margin, so the gap between rows opens with the row. */
  .set-slot + .set-slot {
    padding-top: 1px;
  }
  .set-notes {
    padding: 0 4px 4px 32px;
  }
  .add.comment {
    color: var(--muted);
    font-weight: 500;
  }
  .add {
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
