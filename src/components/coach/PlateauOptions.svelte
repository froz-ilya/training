<script lang="ts">
  import Icon from '../Icon.svelte';
  import { chooseStallAction, undoStallAction, type ExerciseView } from '../../lib/coach/data';
  import { atRotationLimit, plateauOptions, similarExercises } from '../../lib/coach/plateau';
  import { actionLabel, actionText, rotationLimitText } from '../../lib/coach/text';
  import { fmtDate } from '../../lib/dates';
  import { allExercises, nameOf } from '../../lib/exercises.svelte';
  import { t } from '../../lib/i18n.svelte';
  import type { Exercise, StallAction } from '../../lib/types';

  /** Choices for a stalled exercise. Picking one records it, so the outcome can be seen later; a second tap takes it back. */
  let { view }: { view: ExerciseView } = $props();

  const options = $derived(plateauOptions(view.points, view.records, view.expectedGapDays));
  const limited = $derived(atRotationLimit(view.points, view.expectedGapDays));
  const latest = (action: StallAction) =>
    view.records.filter((r) => r.action === action).sort((a, b) => b.date.localeCompare(a.date))[0];
  let exercises = $state<Exercise[]>([]);
  void allExercises().then((all) => (exercises = all));
  const similar = $derived(similarExercises(view.exercise, exercises));
</script>

<div class="section">
  <div class="section-title">{t('coach.options.title')}</div>
  <p class="muted small note">{t('coach.options.note')}</p>
  <div class="list">
    {#each options as action (action)}
      {@const record = latest(action)}
      <button
        class="list-item"
        aria-pressed={!!record}
        onclick={() => (record && !record.helped ? undoStallAction(view, record) : chooseStallAction(view, action))}
      >
        <span class="body">
          <span class="title">{actionLabel(action)}</span>
          <span class="sub">{action === 'frequency' && limited ? rotationLimitText(view.perWeek) : actionText(action)}</span>
          {#if record?.helped}
            <span class="sub tag">{t('coach.options.helped')}</span>
          {:else if record}
            <span class="sub tag">{t('coach.options.chosen', { date: fmtDate(record.date) })}</span>
          {/if}
        </span>
        {#if record}<Icon name="check" size={18} />{/if}
      </button>
    {/each}
  </div>
  {#if latest('swap')}
    <div class="list similar">
      {#each similar as exercise (exercise.id)}
        <a class="list-item" href="#/exercise/{exercise.id}">
          <span class="body"><span class="title">{nameOf(exercise)}</span></span>
          <Icon name="chevron" size={18} />
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .note {
    margin: 0 0 10px;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .tag {
    color: var(--text-2);
  }
  .similar {
    margin-top: 12px;
  }
</style>
