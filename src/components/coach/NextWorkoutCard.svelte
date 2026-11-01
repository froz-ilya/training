<script lang="ts" module>
  import type { SetPlan } from '../../lib/coach/suggest';

  export interface WorkoutDraft {
    exercises: { exerciseId: string; sets: SetPlan[] }[];
  }
</script>

<script lang="ts">
  import Icon from '../Icon.svelte';
  import { loadNextWorkout, type NextWorkout } from '../../lib/coach/data';
  import { nameOf } from '../../lib/exercises.svelte';
  import { t } from '../../lib/i18n.svelte';
  import { workoutTitle } from '../../lib/workout/title';
  import { fmtPlanned } from '../workout/display';

  /**
   * The workout the user's rotation points to. `onstart` starts it as it is; `onedit`, when given,
   * opens the same draft for changes first. Shows nothing for someone with no history.
   */
  let {
    onstart,
    onedit,
  }: { onstart: (draft: WorkoutDraft) => void; onedit?: (draft: WorkoutDraft) => void } = $props();

  let next = $state<NextWorkout | null>(null);

  $effect(() => {
    let stale = false;
    void loadNextWorkout().then((plan) => {
      if (!stale) next = plan;
    });
    return () => {
      stale = true;
    };
  });

  function draft(plan: NextWorkout): WorkoutDraft {
    return { exercises: plan.exercises.map((e) => ({ exerciseId: e.exercise.id, sets: e.sets })) };
  }

  /** The heaviest work set: what the suggestion is really about. */
  const topOf = (sets: SetPlan[]) =>
    sets.filter((s) => s.kind === 'work').reduce<SetPlan | undefined>((top, s) => (!top || s.weightKg > top.weightKg ? s : top), undefined);
</script>

{#if next}
  {@const plan = next}
  <section class="next">
    <div class="head">
      <span class="muted small">{t('coach.next.title')}</span>
      {#if plan.groups.length}<h2>{workoutTitle(plan.groups)}</h2>{/if}
      <span class="muted small week">{t('coach.week.progress', { done: plan.week.done, total: plan.week.total })}</span>
      {#if plan.week.behind}<span class="muted small week">{t('coach.week.behind')}</span>{/if}
    </div>
    <ul>
      {#each plan.exercises as item (item.exercise.id)}
        {@const top = topOf(item.sets)}
        <li>
          <span class="name">{nameOf(item.exercise)}</span>
          <span class="muted small">{top ? fmtPlanned(top, item.exercise.load) : t('coach.next.first')}</span>
        </li>
      {/each}
    </ul>
    <div class="actions">
      <button class="btn btn-primary" onclick={() => onstart(draft(plan))}><Icon name="play" size={18} />{t('common.start')}</button>
      {#if onedit}
        <button class="btn" onclick={() => onedit?.(draft(plan))}>{t('coach.next.edit')}</button>
      {/if}
    </div>
  </section>
{/if}

<style>
  .next {
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
    box-shadow: var(--shadow-feature);
  }
  h2 {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 900;
  }
  .week {
    display: block;
  }
  ul {
    list-style: none;
    margin: 12px 0 16px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .name {
    min-width: 0;
    font-weight: 600;
  }
  li .small {
    flex-shrink: 0;
    max-width: 60%;
    text-align: right;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions .btn-primary {
    flex: 1;
  }
</style>
