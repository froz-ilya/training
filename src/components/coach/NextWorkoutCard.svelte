<script lang="ts" module>
  import type { SetPlan } from '../../lib/coach/suggest';

  export interface WorkoutDraft {
    exercises: { exerciseId: string; sets: SetPlan[] }[];
  }
</script>

<script lang="ts">
  import Icon, { type IconName } from '../Icon.svelte';
  import { loadNextWorkout, type NextWorkout } from '../../lib/coach/data';
  import type { NextPick } from '../../lib/coach/next';
  import { nameOf } from '../../lib/exercises.svelte';
  import { t, tn } from '../../lib/i18n.svelte';
  import { typeTitle } from '../../lib/workout/title';
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

  /** An exercise lives in a workout through its sets, so one with no history starts with an empty set. */
  const FIRST_SETS: SetPlan[] = [{ kind: 'work', weightKg: 0, reps: 0 }];

  function draft(plan: NextWorkout): WorkoutDraft {
    return { exercises: plan.exercises.map((e) => ({ exerciseId: e.exercise.id, sets: e.sets.length ? e.sets : FIRST_SETS })) };
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

  function focusReason({ exercise, region, fresh, replaced }: NextWorkout['focus'][number]): string {
    const names = { region: t(`exercises.region.${region}`), name: nameOf(exercise) };
    if (replaced) return t(fresh ? 'coach.next.focus.swappedNew' : 'coach.next.focus.swapped', { ...names, old: nameOf(replaced) });
    return t(fresh ? 'coach.next.focus.addedNew' : 'coach.next.focus.added', names);
  }

  /** The heaviest work set: what the suggestion is really about. */
  const topOf = (sets: SetPlan[]) =>
    sets.filter((s) => s.kind === 'work').reduce<SetPlan | undefined>((top, s) => (!top || s.weightKg > top.weightKg ? s : top), undefined);
</script>

{#snippet note(icon: IconName, text: string)}
  <li class="note">
    <span class="icon"><Icon name={icon} size={14} /></span>
    {text}
  </li>
{/snippet}

{#if next}
  {@const plan = next}
  {@const reasons = [plan.week.behind, plan.typeReason, plan.reason].filter(Boolean).length}
  {@const notes = plan.leftOut.length || plan.added.length || plan.focus.length || plan.standIns.length}
  {@const switches = [plan.otherTypes, plan.otherVariants].filter((options) => options.length).length}
  <section class="card next">
    <div class="plan">
      <div class="head">
        <span class="muted small">{t('coach.next.title')}</span>
        {#if plan.groups.length}<h2>{typeTitle(plan.groups, plan.partners)}</h2>{/if}
        <span class="muted small week">
          {plan.week.done < plan.week.total ? t('coach.week.progress', { done: plan.week.done, total: plan.week.total }) : tn('coach.week.count', plan.week.done)}
        </span>
      </div>
      <ul class="exercises">
        {#each plan.exercises as item (item.exercise.id)}
          {@const top = topOf(item.sets)}
          <li>
            <a class="name" href="#/exercise/{encodeURIComponent(item.exercise.id)}">{nameOf(item.exercise)}</a>
            <span class="top {top ? 'numbers' : 'muted small'}">{top ? fmtPlanned(top, item.exercise.load) : t('coach.next.first')}</span>
          </li>
        {/each}
      </ul>
      <div class="actions">
        <button class="btn btn-primary" disabled={switching} onclick={() => onstart(draft(plan))}><Icon name="play" size={18} />{t('common.start')}</button>
        {#if onedit}
          <button class="btn" disabled={switching} onclick={() => onedit?.(draft(plan))}>{t('coach.next.edit')}</button>
        {/if}
      </div>
    </div>
    {#if reasons || notes || switches}
      <div class="tray" class:inline={reasons <= 1 && !notes && switches <= 1}>
        {#if reasons}
          <div class="reasons">
            {#if plan.week.behind}<p>{t('coach.week.behind')}</p>{/if}
            {#if plan.typeReason}
              <p>{t(TYPE_REASON_KEYS[plan.typeReason.kind], { types: plan.typeReason.types.map((type) => typeTitle(type.groups, type.partners)).join(' → ') })}</p>
            {/if}
            {#if plan.reason}
              <p>{t(REASON_KEYS[plan.reason.kind], { last: nameOf(plan.reason.after), next: nameOf(plan.reason.lead) })}</p>
            {/if}
          </div>
        {/if}
        {#if notes}
          <ul class="notes">
            {#each plan.focus as pick (pick.exercise.id)}
              {@render note('target', focusReason(pick))}
            {/each}
            {#each plan.standIns as swap (swap.instead.id)}
              {@render note('swap', t(swap.fresh ? 'coach.next.standInNew' : 'coach.next.standIn', { name: nameOf(swap.exercise), old: nameOf(swap.instead) }))}
            {/each}
            {#if plan.leftOut.length}
              {@render note('minus', t('coach.next.budget.leftOut', { names: plan.leftOut.map(nameOf).join(', ') }))}
            {/if}
            {#if plan.added.length}
              {@render note('plus', t('coach.next.budget.added', { names: plan.added.map((muscle) => t(`exercises.muscle.${muscle}`)).join(', ') }))}
            {/if}
          </ul>
        {/if}
        {#if switches}
          <div class="switches">
            {#if plan.otherTypes.length}
              <div class="switch" role="group" aria-label={t('coach.next.type.switch')}>
                <span>{t('coach.next.type.switch')}</span>
                {#each plan.otherTypes as type (type.key)}
                  <button class="tap" onclick={() => (picked = { type: type.key })}><span class="chip">{typeTitle(type.groups, type.partners)}</span></button>
                {/each}
              </div>
            {/if}
            {#if plan.otherVariants.length}
              <div class="switch" role="group" aria-label={t('coach.next.variant.switch')}>
                <span>{t('coach.next.variant.switch')}</span>
                {#each plan.otherVariants as other (other.id)}
                  <button class="tap" onclick={() => (picked = { ...picked, lead: other.id })}><span class="chip">{nameOf(other)}</span></button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .next {
    padding: 0;
    overflow: hidden;
  }
  .plan {
    padding: 12px 16px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 8px;
  }
  h2 {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 900;
    line-height: 30px;
    overflow-wrap: anywhere;
  }
  .week {
    margin-left: auto;
  }
  .exercises {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .exercises li {
    display: flex;
    align-items: center;
    gap: 12px;
    border-top: 1px solid var(--hairline);
  }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    min-height: 43px;
    padding: 2px 0;
    color: inherit;
    font-size: 16px;
    font-weight: 600;
    line-height: 21px;
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .top {
    flex-shrink: 0;
    max-width: 60%;
    line-height: 21px;
    text-align: right;
  }
  .numbers {
    font-size: 16px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .actions .btn-primary {
    flex: 1;
  }
  .tray {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px;
    background: var(--inset-bg);
    box-shadow: inset 0 1px 0 var(--hairline);
    color: var(--muted);
    font-size: 13px;
    line-height: 18px;
  }
  /* One reason and one row of chips share a line, and wrap when they don't fit. */
  .tray.inline {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding-block: 9px;
  }
  .reasons,
  .notes {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .inline .reasons {
    flex: 1 1 200px;
    min-width: 0;
  }
  .reasons p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .notes {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .note {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr);
    gap: 8px;
  }
  .icon {
    display: flex;
    align-items: center;
    height: 18px;
  }
  .switches {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    padding-bottom: 2px;
  }
  .inline .switches {
    padding-bottom: 0;
  }
  .switch {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px 8px;
  }
  /* A 44px target round a 30px pill. The negative margin keeps rows spaced by the pill, and the 14px
     row gap makes the targets of neighbouring rows meet. */
  .tap {
    display: inline-flex;
    align-items: center;
    min-width: 44px;
    max-width: 100%;
    margin-block: -7px;
    padding: 7px 0;
    border: 0;
    background: none;
    cursor: pointer;
    text-align: left;
  }
  .tap .chip {
    min-width: 0;
    min-height: 30px;
    margin-block: 0;
    color: var(--text);
    line-height: 20px;
    overflow-wrap: anywhere;
  }
  .tap:focus-visible {
    outline: none;
  }
  .tap:focus-visible .chip {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
