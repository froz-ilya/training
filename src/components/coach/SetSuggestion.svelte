<script lang="ts">
  import { liveQuery } from 'dexie';
  import { loadExerciseView, type ExerciseView } from '../../lib/coach/data';
  import type { Suggestion } from '../../lib/coach/suggest';
  import { reasonText } from '../../lib/coach/text';
  import { t } from '../../lib/i18n.svelte';
  import { fmtPlanned } from '../workout/display';

  /**
   * The weight and reps for today on one line, and why on a second that opens on tap. `position`
   * is the exercise's place in today's workout. Shows nothing with no history to go on.
   */
  let {
    exerciseId,
    position,
    onapply,
  }: { exerciseId: string; position?: number; onapply?: (suggestion: Suggestion) => void } = $props();

  let view = $state<ExerciseView | null>(null);
  let expanded = $state(false);

  $effect(() => {
    const id = exerciseId;
    const place = position;
    const sub = liveQuery(() => loadExerciseView(id, place)).subscribe({
      next: (v) => (view = v),
      error: (e) => console.error(e),
    });
    return () => sub.unsubscribe();
  });

  const suggestion = $derived(view?.suggestion ?? null);
  const load = $derived(view?.exercise.load ?? 'weight');
  /** The level sits on the sets, not on the suggestion. */
  const level = $derived(suggestion?.sets.find((s) => s.kind === 'work')?.level);
</script>

{#if suggestion}
  <div class="suggestion">
    <div class="line">
      <b>{t('coach.suggest.today')} <span class="set">{fmtPlanned({ ...suggestion, level }, load)}</span></b>
      {#if onapply}
        <button class="apply" onclick={() => suggestion && onapply?.(suggestion)}>{t('coach.suggest.apply')}</button>
      {/if}
    </div>
    <button class="reason muted small" class:expanded aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
      {reasonText(suggestion)}
    </button>
  </div>
{/if}

<style>
  .suggestion {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 44px;
  }
  .line b {
    min-width: 0;
    font-weight: 700;
    line-height: 1.25;
    overflow-wrap: break-word;
  }
  /* The numbers keep together on their own line when they don't fit beside the button. */
  .set {
    display: inline-block;
    max-width: 100%;
  }
  .apply {
    flex-shrink: 0;
    min-height: 44px;
    padding: 4px 12px;
    border: 0;
    border-radius: var(--radius-xs);
    background: var(--surface-3);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
  }
  /* The text is one line, the tap target a full 44px; the last few px sit in the space below. */
  .reason {
    width: 100%;
    min-height: 44px;
    margin-bottom: -8px;
    padding: 12px 0;
    border: 0;
    background: none;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reason.expanded {
    white-space: normal;
  }
</style>
