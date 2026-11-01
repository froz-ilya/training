<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { fmtDate } from '../lib/dates';
  import { activeWorkout, deleteWorkout, finishedWorkouts, repeatWorkout, summarize } from '../lib/db/repo';
  import { t, tn } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { go } from '../lib/router.svelte';
  import { workoutTitle } from '../lib/workout/title';
  import { chooseAction, showToast, undoToast } from '../lib/ui/dialogs.svelte';
  import type { Workout } from '../lib/types';

  /** History grows into the hundreds, so it loads a page at a time. */
  const PAGE = 40;

  let shown = $state(PAGE);

  const data = live(
    async (limit) => {
      const workouts = await finishedWorkouts(limit + 1);
      const page = workouts.slice(0, limit);
      return { page, summaries: await summarize(page.map((w) => w.id)), hasMore: workouts.length > limit };
    },
    () => shown,
  );

  const months = $derived.by(() => {
    const groups: { month: string; workouts: Workout[] }[] = [];
    for (const workout of data.value?.page ?? []) {
      const month = workout.date.slice(0, 7);
      const group = groups.at(-1);
      if (group?.month === month) group.workouts.push(workout);
      else groups.push({ month, workouts: [workout] });
    }
    return groups;
  });

  const titleOf = (workout: Workout) => workoutTitle(data.value?.summaries.get(workout.id)?.groups ?? []);

  function menu(workout: Workout) {
    void chooseAction(titleOf(workout), [
      {
        label: t('workout.repeat'),
        icon: 'refresh',
        run: async () => {
          const active = await activeWorkout();
          if (active) {
            showToast(t('workout.finishOtherFirst'));
            go(`/workout/${active.id}`);
          } else {
            go(`/workout/${await repeatWorkout(workout.id)}`);
          }
        },
      },
      {
        label: t('workout.delete'),
        icon: 'trash',
        destructive: true,
        run: async () => undoToast(t('workout.deleted'), await deleteWorkout(workout.id)),
      },
    ]);
  }
</script>

<div class="page">
  <Header title={t('shell.tab.history')} />

  {#if data.value === undefined}
    <Skeleton lines={6} />
  {:else if months.length}
    {#each months as group (group.month)}
      <section class="section">
        <h2 class="section-title">{fmtDate(`${group.month}-01`, { month: 'long', year: 'numeric' })}</h2>
        <div class="list">
          {#each group.workouts as workout (workout.id)}
            {@const summary = data.value.summaries.get(workout.id)}
            <div class="list-item row-item">
              <a class="open" href="#/workout/{workout.id}">
                <span class="title">{titleOf(workout)}</span>
                <span class="sub">
                  {fmtDate(workout.date, { day: 'numeric', month: 'short', weekday: 'short' })}
                  {#if summary}· {tn('common.exercises', summary.exercises)} · {tn('common.sets', summary.sets)}{/if}
                </span>
              </a>
              <button class="icon-btn" aria-label={t('workout.more')} onclick={() => menu(workout)}><Icon name="more" /></button>
            </div>
          {/each}
        </div>
      </section>
    {/each}
    {#if data.value.hasMore}
      <button class="btn btn-block more" onclick={() => (shown += PAGE)}>{t('workout.showMore')}</button>
    {/if}
  {:else}
    <p class="empty">{t('workout.historyEmpty')}</p>
  {/if}
</div>

<style>
  .section:first-of-type {
    margin-top: 8px;
  }
  .row-item {
    padding-top: 0;
    padding-bottom: 0;
    padding-right: 6px;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 60px;
    padding: 9px 0;
    color: inherit;
    text-decoration: none;
  }
  .more {
    margin-top: 16px;
  }
</style>
