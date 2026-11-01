<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import NextWorkoutCard, { type WorkoutDraft } from '../components/coach/NextWorkoutCard.svelte';
  import { fmtDate, toISODate } from '../lib/dates';
  import { activeWorkout, createFromPlan, createWorkout, finishedWorkouts, planForEditing, repeatWorkout, summarize } from '../lib/db/repo';
  import { db } from '../lib/db/schema';
  import { t, tn } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { go } from '../lib/router.svelte';
  import { workoutTitle } from '../lib/workout/title';
  import type { Workout } from '../lib/types';

  const RECENT = 5;

  const data = live(async () => {
    const active = await activeWorkout();
    const activeSets = active ? await db.sets.where('workoutId').equals(active.id).toArray() : [];
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const [planned, recent, thisWeek] = await Promise.all([
      db.workouts.where('status').equals('planned').toArray(),
      finishedWorkouts(RECENT),
      db.workouts
        .where('date')
        .aboveOrEqual(toISODate(weekAgo))
        .filter((w) => w.status === 'done')
        .count(),
    ]);
    const shown = [...(active ? [active] : []), ...planned, ...recent];
    return { active, activeSets, planned, recent, thisWeek, summaries: await summarize(shown.map((w) => w.id)) };
  });

  const active = $derived(data.value?.active);
  const doneSets = $derived(data.value?.activeSets.filter((s) => s.done).length ?? 0);
  const allSets = $derived(data.value?.activeSets.length ?? 0);

  const titleOf = (workout: Workout) => workoutTitle(data.value?.summaries.get(workout.id)?.groups ?? []);

  async function startEmpty() {
    go(`/workout/${await createWorkout()}`);
  }

  async function startDraft(draft: WorkoutDraft) {
    go(`/workout/${await createFromPlan(draft, 'active')}`);
  }

  async function editDraft(draft: WorkoutDraft) {
    go(`/workout/${await planForEditing(draft)}`);
  }

  async function repeat(workout: Workout) {
    go(`/workout/${await repeatWorkout(workout.id)}`);
  }
</script>

<div class="page">
  <Header title={t('shell.tab.today')} subtitle={fmtDate(toISODate(), { weekday: 'long', day: 'numeric', month: 'long' })} />

  {#if data.value}
    <div class="content-in">
      {#if active}
        <a class="hero pressable" href="#/workout/{active.id}">
          <span class="kicker">{t('workout.inProgress')}</span>
          <span class="hero-title">{titleOf(active)}</span>
          <span class="muted">{t('workout.progressLine', { done: doneSets, total: allSets })}</span>
          <span class="btn btn-primary btn-block btn-lg">{t('workout.resume')}</span>
        </a>
      {:else}
        <div class="stack">
          <NextWorkoutCard onstart={startDraft} onedit={editDraft} />
          <button class="btn btn-block btn-lg" onclick={startEmpty}>
            <Icon name="plus" size={22} />
            {t('workout.new')}
          </button>
        </div>
      {/if}

      {#if data.value.planned.length}
        <section class="section">
          <h2 class="section-title">{t('workout.planned')}</h2>
          <div class="list">
            {#each data.value.planned as workout (workout.id)}
              <a class="list-item" href="#/workout/{workout.id}">
                <span class="grow title">{titleOf(workout)}</span>
                <Icon name="chevron" size={18} />
              </a>
            {/each}
          </div>
        </section>
      {/if}

      {#if data.value.recent.length}
        <section class="section">
          <h2 class="section-title">
            {t('workout.recent')}
            <span class="count">{tn('workout.thisWeek', data.value.thisWeek)}</span>
          </h2>
          <div class="list">
            {#each data.value.recent as workout (workout.id)}
              <div class="list-item recent">
                <a class="grow open" href="#/workout/{workout.id}">
                  <span class="title">{titleOf(workout)}</span>
                  <span class="sub">{fmtDate(workout.date)}</span>
                </a>
                {#if !active}
                  <button class="icon-btn" aria-label={t('workout.repeatNamed', { name: titleOf(workout) })} onclick={() => repeat(workout)}>
                    <Icon name="refresh" />
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {:else if !active}
        <div class="empty">
          <p>{t('workout.none')}</p>
          <p class="small">{t('workout.noneHint')}</p>
          <a class="btn btn-ghost" href="#/import">{t('workout.importHistory')}</a>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 20px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
    box-shadow: var(--shadow-feature);
    color: inherit;
    text-decoration: none;
  }
  .kicker {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 800;
    color: var(--accent);
  }
  .hero-title {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 900;
    overflow-wrap: anywhere;
  }
  .hero .btn {
    margin-top: 12px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .count {
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: var(--muted);
  }
  .recent {
    padding-top: 0;
    padding-bottom: 0;
  }
  .open {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 54px;
    padding: 9px 0;
    color: inherit;
    text-decoration: none;
  }
</style>
