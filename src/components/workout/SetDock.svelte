<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from '../Icon.svelte';
  import NumberStepper from './NumberStepper.svelte';
  import { t } from '../../lib/i18n.svelte';
  import { dur } from '../../lib/motion';
  import { fmtCompact } from './display';
  import type { SessionSet } from '../../lib/coach/strength';
  import type { Load, WorkoutSet } from '../../lib/types';

  /**
   * The controls for the selected set. They sit in one place at the bottom of the screen, so the
   * table above never moves and stays short.
   */
  type Changes = Partial<Pick<WorkoutSet, 'weightKg' | 'reps' | 'seconds' | 'kind' | 'failure' | 'level'>>;

  let {
    set,
    title,
    number,
    previous,
    load,
    levels,
    step,
    checkable,
    onchange,
    oncheck,
    onremove,
    oncomment,
    onclose,
  }: {
    set: WorkoutSet;
    /** Name of the exercise. */
    title: string;
    number: number;
    previous: SessionSet | undefined;
    load: Load;
    /** The exercise is done at a level, which gets its own stepper. */
    levels: boolean;
    step: number;
    checkable: boolean;
    onchange: (changes: Changes) => void;
    oncheck: () => void;
    onremove: () => void;
    oncomment: () => void;
    onclose: () => void;
  } = $props();

  const warmup = $derived(set.kind === 'warmup');

  /** How far the iOS keyboard reaches into the screen: the dock rides above it. */
  let lift = $state(0);
  $effect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => (lift = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  });
</script>

<div
  class="dock"
  role="group"
  aria-label={t('workout.nextSetDock')}
  style:transform={lift ? `translateY(-${lift}px)` : undefined}
  transition:fly={{ y: 40, duration: dur(160) }}
>
  <div class="top">
    <span class="title">
      <b>{warmup ? t('workout.warmup') : t('workout.setNumber', { n: number })}</b>
      · {previous ? `${title} · ${fmtCompact(previous, load)}` : title}
    </span>
    <button type="button" class="icon-btn remove" aria-label={t('workout.removeSet')} onclick={onremove}>
      <Icon name="trash" size={20} />
    </button>
    <button type="button" class="comment" aria-label={t('notes.title.set')} onclick={oncomment}>
      <Icon name="comment" size={20} />
    </button>
    <button type="button" class="close" aria-label={t('common.close')} onclick={onclose}><Icon name="x" size={18} /></button>
  </div>

  {#key set.id}
    <div class="steppers" class:stacked={levels && load !== 'time'}>
      {#if load === 'time'}
        <NumberStepper
          label={t('workout.secondsLabel')}
          unit={t('workout.secondsLabel')}
          value={set.seconds ?? 0}
          step={5}
          onchange={(seconds) => onchange({ seconds })}
        />
      {:else}
        {#if levels}
          <NumberStepper
            label={t('workout.levelLabel')}
            unit={t('workout.levelLabel')}
            value={set.level ?? 0}
            step={1}
            onchange={(level) => onchange({ level: level > 0 ? level : undefined })}
          />
        {/if}
        <NumberStepper
          label={load === 'body' ? t('workout.addedWeightLabel') : t('workout.weightLabel')}
          unit={load === 'body' ? t('workout.col.added') : t('workout.col.kg')}
          value={set.weightKg}
          {step}
          decimals
          onchange={(weightKg) => onchange({ weightKg })}
        />
        <NumberStepper
          label={t('workout.repsLabel')}
          unit={t('workout.col.reps')}
          value={set.reps}
          step={1}
          decimals
          onchange={(reps) => onchange({ reps })}
        />
      {/if}
    </div>
  {/key}

  <div class="bottom">
    <div class="segmented kinds">
      <button type="button" class:active={warmup} onclick={() => onchange({ kind: 'warmup', failure: undefined })}>{t('workout.warmupTab')}</button>
      <button type="button" class:active={!warmup} onclick={() => onchange({ kind: 'work' })}>{t('workout.workTab')}</button>
    </div>
    {#if !warmup}
      <button
        type="button"
        class="failure"
        class:active={set.failure}
        aria-pressed={!!set.failure}
        onclick={() => onchange({ failure: set.failure ? undefined : true })}
      >
        {t('workout.failure')}
      </button>
    {/if}
    {#if checkable}
      <button
        type="button"
        class="btn btn-primary done"
        aria-pressed={set.done}
        aria-label={set.done ? t('workout.uncheckSet') : t('workout.checkSet')}
        onclick={oncheck}
      >
        <Icon name="check" size={24} />
      </button>
    {/if}
  </div>
</div>

<style>
  .dock {
    position: fixed;
    left: 50%;
    bottom: 0;
    z-index: 20;
    box-sizing: border-box;
    width: min(100%, 640px);
    margin-left: calc(min(100%, 640px) / -2);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 12px calc(var(--safe-bottom) + 8px);
    border-radius: var(--radius) var(--radius) 0 0;
    background: var(--surface-raised);
    box-shadow: var(--shadow-lg);
  }
  .top {
    display: flex;
    align-items: center;
    /* Tap targets reach into the gap below, so the dock stays as short as the page expects. */
    margin-bottom: -4px;
  }
  .title {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title b {
    color: var(--text);
    font-weight: 700;
  }
  .close,
  .comment {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .close {
    margin-right: -8px;
  }
  .comment {
    color: var(--accent);
  }
  .steppers {
    display: flex;
    gap: 8px;
  }
  /* Three steppers don't fit side by side on a phone: the first two sit together, and the last takes a row. */
  .steppers.stacked {
    flex-wrap: wrap;
    gap: 6px 8px;
  }
  .steppers.stacked :global(.stepper) {
    flex: 1 1 calc(50% - 4px);
  }
  .bottom {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .kinds {
    flex: 1 1 auto;
    min-width: max-content;
  }
  /* Sized by their words, so a long one can take space from a short one on a narrow phone. */
  .kinds button {
    flex: 1 1 auto;
    padding: 0 4px;
    font-size: 13px;
    white-space: nowrap;
  }
  .failure {
    flex-shrink: 0;
    min-height: 44px;
    padding: 0 8px;
    border: 0;
    border-radius: 12px;
    background: var(--surface-3);
    color: var(--text-2);
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    touch-action: manipulation;
  }
  .failure.active {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent);
    color: var(--accent);
  }
  .remove {
    color: var(--bad);
  }
  .done {
    flex: 0 1 64px;
    min-width: 48px;
    min-height: 48px;
    padding: 0;
  }
</style>
