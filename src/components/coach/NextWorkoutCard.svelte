<script lang="ts" module>
  import type { SetPlan } from '../../lib/coach/suggest';

  export interface WorkoutDraft {
    exercises: { exerciseId: string; sets: SetPlan[] }[];
  }
</script>

<script lang="ts">
  import Icon from '../Icon.svelte';
  import { loadNextWorkout, type NextWorkout } from '../../lib/coach/data';
  import type { NextPick } from '../../lib/coach/next';
  import { nameOf } from '../../lib/exercises.svelte';
  import { t, tn } from '../../lib/i18n.svelte';
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
  /** The type or variant tapped on the card. Only for now: the rotation decides next time. */
  let picked = $state.raw<NextPick>({});
  let shown = $state.raw<NextPick | null>(null);
  /** Start and Edit wait for the switched plan, so a quick tap never takes the old one. */
  const switching = $derived(shown !== picked);

  $effect(() => {
    let stale = false;
    const pick = picked;
    void loadNextWorkout(pick).then((plan) => {
      if (stale) return;
      next = plan;
      shown = pick;
    });
    return () => {
      stale = true;
    };
  });

  function draft(plan: NextWorkout): WorkoutDraft {
    return { exercises: plan.exercises.map((e) => ({ exerciseId: e.exercise.id, sets: e.sets })) };
  }

  const TYPE_REASON_KEYS = {
    usual: 'coach.next.type.usual',
    before: 'coach.next.type.before',
    longest: 'coach.next.type.longest',
  } as const;

  const REASON_KEYS = {
    alternate: 'coach.next.variant.alternate',
    afterOneOff: 'coach.next.variant.afterOneOff',
    again: 'coach.next.variant.again',
  } as const;

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
      <span class="muted small week">
        {plan.week.done < plan.week.total ? t('coach.week.progress', { done: plan.week.done, total: plan.week.total }) : tn('coach.week.count', plan.week.done)}
      </span>
      {#if plan.week.behind}<span class="muted small week">{t('coach.week.behind')}</span>{/if}
    </div>
    {#if plan.typeReason}
      <p class="muted small reason">{t(TYPE_REASON_KEYS[plan.typeReason.kind], { types: plan.typeReason.types.map((type) => workoutTitle([type])).join(' → ') })}</p>
    {/if}
    {#if plan.reason}
      <p class="muted small reason">{t(REASON_KEYS[plan.reason.kind], { last: nameOf(plan.reason.after), next: nameOf(plan.reason.lead) })}</p>
    {/if}
    <ul>
      {#each plan.exercises as item (item.exercise.id)}
        {@const top = topOf(item.sets)}
        <li>
          <span class="name">{nameOf(item.exercise)}</span>
          <span class="muted small">{top ? fmtPlanned(top, item.exercise.load) : t('coach.next.first')}</span>
        </li>
      {/each}
    </ul>
    {#if plan.otherTypes.length || plan.otherVariants.length}
      <div class="switches">
        {#if plan.otherTypes.length}
          <div class="switch" role="group" aria-label={t('coach.next.type.switch')}>
            <span class="muted small">{t('coach.next.type.switch')}</span>
            {#each plan.otherTypes as type (type)}
              <button class="chip" onclick={() => (picked = { type })}>{workoutTitle([type])}</button>
            {/each}
          </div>
        {/if}
        {#if plan.otherVariants.length}
          <div class="switch" role="group" aria-label={t('coach.next.variant.switch')}>
            <span class="muted small">{t('coach.next.variant.switch')}</span>
            {#each plan.otherVariants as other (other.id)}
              <button class="chip" onclick={() => (picked = { ...picked, lead: other.id })}>{nameOf(other)}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <div class="actions">
      <button class="btn btn-primary" disabled={switching} onclick={() => onstart(draft(plan))}><Icon name="play" size={18} />{t('common.start')}</button>
      {#if onedit}
        <button class="btn" disabled={switching} onclick={() => onedit?.(draft(plan))}>{t('coach.next.edit')}</button>
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
  .reason {
    margin: 6px 0 0;
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
  .switches {
    margin: -8px 0 8px;
  }
  .switch {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 8px;
  }
  .switch .chip {
    border: 0;
    cursor: pointer;
    min-width: 0;
    max-width: 100%;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions .btn-primary {
    flex: 1;
  }
</style>
