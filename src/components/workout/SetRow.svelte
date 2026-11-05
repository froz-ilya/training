<script lang="ts">
  import Icon from '../Icon.svelte';
  import { fmtNumber, t } from '../../lib/i18n.svelte';
  import { changeText, fmtCompact, isPlan, levelNote, weightCell } from './display';
  import type { SessionSet } from '../../lib/coach/strength';
  import type { SetComparison } from '../../lib/coach/compare';
  import type { Load, WorkoutSet } from '../../lib/types';

  /**
   * One line of the sets table. Its change compares it with the same set last time, never with the
   * set above it, so reps falling set by set show nothing unless they're below last time. Tapping
   * a line selects it for the dock at the bottom of the screen.
   */
  let {
    set,
    number,
    previous,
    change,
    calm,
    load,
    checkable,
    selected,
    onselect,
    oncheck,
  }: {
    set: WorkoutSet;
    /** Position among the work sets. */
    number: number;
    /** The same set last time. */
    previous: SessionSet | undefined;
    change: SetComparison | null;
    /** A lower number is normal this late in the workout, so it isn't shown as a loss. */
    calm: boolean;
    load: Load;
    /** The check button shows while a workout is being logged. */
    checkable: boolean;
    selected: boolean;
    onselect: () => void;
    oncheck: () => void;
  } = $props();

  const warmup = $derived(set.kind === 'warmup');
  const plan = $derived(isPlan(set, previous));
  const arrow = $derived(change?.trend === 'up' ? '▲' : change?.trend === 'down' ? '▼' : '=');
  const level = $derived(levelNote(set.weightKg, load, set.level));
</script>

{#snippet failureMark()}
  {#if set.failure}<span class="failure-mark" role="img" aria-label={t('exercise.failure')}>{t('exercise.failureShort')}</span>{/if}
{/snippet}

<div class="row" class:warmup class:selected class:checkable data-set={set.id}>
  <button type="button" class="cells" aria-pressed={selected} onclick={onselect}>
    <span class="number" aria-label={warmup ? t('workout.warmup') : t('workout.setNumber', { n: number })}>
      {warmup ? t('workout.warmupShort') : number}
    </span>
    <span class="last">
      <span class="previous">{previous ? fmtCompact(previous, load) : '–'}</span>
      {#if change && set.done && !warmup}
        <span class="change {change.trend}" class:calm={calm && change.trend === 'down'}>
          <span aria-hidden="true">{arrow}</span>
          {changeText(change)}
        </span>
      {:else if set.extra && !warmup}
        <span class="extra">{t('workout.extraSet')}</span>
      {/if}
    </span>
    {#if load === 'time'}
      <span class="value" class:plan>{fmtCompact(set, load)}{@render failureMark()}</span>
    {:else}
      <span class="value" class:plan>
        {weightCell(set.weightKg, load, set.level)}
        {#if level}<small class="level">{level}</small>{/if}
      </span>
      <span class="value" class:plan>{fmtNumber(set.reps)}{@render failureMark()}</span>
    {/if}
  </button>
  {#if checkable}
    <button
      type="button"
      class="check"
      class:checked={set.done}
      aria-pressed={set.done}
      aria-label={set.done ? t('workout.uncheckSet') : t('workout.checkSet')}
      onclick={oncheck}
    >
      <Icon name="check" size={20} />
    </button>
  {/if}
</div>

<style>
  .row {
    display: flex;
    align-items: stretch;
    border-radius: 10px;
    /* Clears the dock when the row is scrolled into view. */
    scroll-margin: 16px 0 var(--dock-clear, 210px);
    transition: background-color var(--dur-fast) var(--ease);
  }
  .row.selected {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .cells {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    display: grid;
    grid-template-columns: var(--set-columns);
    gap: var(--set-gap);
    align-items: center;
    padding: 3px 4px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    font-variant-numeric: tabular-nums;
  }
  .number {
    display: grid;
    place-items: center;
    height: 24px;
    border-radius: 7px;
    background: var(--surface-3);
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 800;
    color: var(--text-2);
  }
  .warmup .number {
    background: none;
    color: var(--muted);
    font-weight: 700;
  }
  .last {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .previous {
    font-size: 13px;
    line-height: 1.2;
    color: var(--muted);
  }
  .change {
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
  }
  .change.up {
    color: var(--good-strong);
  }
  .change.down {
    color: var(--bad-strong);
  }
  .change.down.calm {
    color: var(--text-2);
  }
  .extra {
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
    color: var(--accent-strong);
  }
  .value {
    min-width: 0;
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 800;
    text-align: center;
    /* A long number pushes the failure mark onto its own line rather than cutting it off. */
    overflow-wrap: anywhere;
  }
  .level {
    display: block;
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    color: var(--muted);
  }
  /* Last time's numbers: what to beat, not what was done. */
  .value.plan {
    color: var(--muted);
    font-weight: 600;
  }
  .warmup .value {
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
  }
  .check {
    flex: 0 0 44px;
    width: 44px;
    min-height: 44px;
    margin-left: 2px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--muted);
    cursor: pointer;
    touch-action: manipulation;
    transition:
      background-color var(--dur-fast) var(--ease),
      transform var(--dur-fast) var(--ease);
  }
  .check:active {
    transform: scale(0.94);
  }
  .check.checked {
    background: var(--good);
    color: var(--on-tone);
  }
  .warmup .check {
    background: none;
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .warmup .check.checked {
    background: var(--surface-3);
    box-shadow: none;
    color: var(--text-2);
  }
</style>
