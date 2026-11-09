<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../Icon.svelte';
  import Sheet from '../Sheet.svelte';
  import { searchExercises } from '../../lib/catalog/exercises';
  import { allExercises, nameOf } from '../../lib/exercises.svelte';
  import { loadReplacements, saveExerciseSettings } from '../../lib/coach/data';
  import { quickCustomExercise, recentExerciseIds } from '../../lib/db/repo';
  import { db } from '../../lib/db/schema';
  import { t } from '../../lib/i18n.svelte';
  import type { Exercise } from '../../lib/types';

  /**
   * Bottom sheet for choosing an exercise; search works in all three languages. With `replacing`, it
   * picks what goes in that exercise's place: the coach's picks come first, and the user can say how
   * often the replaced exercise should come back in plans. `inWorkout` isn't offered again.
   */
  let {
    open = $bindable(false),
    onpick,
    replacing,
    inWorkout = [],
  }: { open?: boolean; onpick: (exerciseId: string) => void; replacing?: Exercise; inWorkout?: string[] } = $props();

  let options = $state<{ exercise: Exercise; fresh: boolean }[]>([]);
  let suggesting = $state<'yes' | 'sometimes' | 'no'>('yes');

  // Read once as the sheet opens: the workout reloads as the setting saves, and must not undo a tap.
  const targetId = $derived(open ? replacing?.id : undefined);
  $effect(() => {
    const id = targetId;
    options = [];
    if (!id) return;
    const others = untrack(() => inWorkout);
    void loadReplacements(id, others).then((found) => (options = found));
    void db.exerciseSettings.get(id).then((saved) => {
      suggesting = saved?.avoid ? 'no' : saved?.sometimes ? 'sometimes' : 'yes';
    });
  });

  /** The same setting as on the exercise's page: "Don't suggest" wins over "Sometimes". */
  function setSuggesting(value: 'yes' | 'sometimes' | 'no') {
    if (!replacing || value === suggesting) return;
    suggesting = value;
    void saveExerciseSettings(replacing.id, { avoid: value === 'no' ? true : undefined, sometimes: value === 'sometimes' ? true : undefined });
  }

  let query = $state('');
  let exercises = $state<Exercise[]>([]);
  let recentIds = $state<string[]>([]);

  $effect(() => {
    if (!open) return;
    query = '';
    void Promise.all([allExercises(), recentExerciseIds()]).then(([all, recent]) => {
      exercises = all;
      recentIds = recent;
    });
  });

  const byName = (list: Exercise[]) => [...list].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const recent = $derived(
    recentIds.map((id) => exercises.find((e) => e.id === id)).filter((e): e is Exercise => !!e),
  );
  const searching = $derived(query.trim().length > 0);
  const results = $derived.by(() => {
    if (!searching) return byName(exercises);
    // Among matches, what the user actually does comes first; the sort keeps the search's order.
    const rank = (e: Exercise) => (recentIds.includes(e.id) ? 0 : 1);
    return searchExercises(exercises, query).sort((a, b) => rank(a) - rank(b));
  });

  function pick(id: string) {
    open = false;
    onpick(id);
  }

  async function create() {
    pick(await quickCustomExercise(query.trim()));
  }
</script>

{#snippet row(exercise: Exercise)}
  <button type="button" class="list-item" onclick={() => pick(exercise.id)}>
    <span class="name">{nameOf(exercise)}</span>
  </button>
{/snippet}

<Sheet bind:open tall title={replacing ? t('workout.replaceTitle', { name: nameOf(replacing) }) : t('workout.pickTitle')}>
  <div class="picker">
    {#if replacing && !searching}
      {#if options.length}
        <h3 class="section-title">{t('workout.replaceSuggested')}</h3>
        <div class="list">
          {#each options as option (option.exercise.id)}
            <button type="button" class="list-item" onclick={() => pick(option.exercise.id)}>
              <span class="name">{nameOf(option.exercise)}</span>
              {#if option.fresh}<span class="badge">{t('workout.replaceNew')}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
      <div class="future">
        <span class="label" id="replace-future">{t('workout.replaceFuture', { name: nameOf(replacing) })}</span>
        <div class="segmented" role="group" aria-labelledby="replace-future">
          <button type="button" class:active={suggesting === 'yes'} aria-pressed={suggesting === 'yes'} onclick={() => setSuggesting('yes')}>
            {t('exercise.suggest.yes')}
          </button>
          <button type="button" class:active={suggesting === 'sometimes'} aria-pressed={suggesting === 'sometimes'} onclick={() => setSuggesting('sometimes')}>
            {t('exercise.suggest.sometimes')}
          </button>
          <button type="button" class:active={suggesting === 'no'} aria-pressed={suggesting === 'no'} onclick={() => setSuggesting('no')}>
            {t('exercise.suggest.no')}
          </button>
        </div>
        {#if suggesting === 'no'}
          <p class="muted small">{t('exercise.suggest.avoided')}</p>
        {:else if suggesting === 'sometimes'}
          <p class="muted small">{t('exercise.suggest.sometimesHint')}</p>
        {/if}
      </div>
    {/if}

    <input class="input" type="search" placeholder={t('workout.searchPlaceholder')} aria-label={t('common.search')} bind:value={query} />

    {#if !searching && recent.length}
      <h3 class="section-title">{t('workout.recentExercises')}</h3>
      <div class="list">
        {#each recent as exercise (exercise.id)}{@render row(exercise)}{/each}
      </div>
      <h3 class="section-title">{t('workout.allExercises')}</h3>
    {/if}

    {#if results.length}
      <div class="list">
        {#each results as exercise (exercise.id)}{@render row(exercise)}{/each}
      </div>
    {:else if searching}
      <p class="empty">{t('workout.noMatch')}</p>
      <button type="button" class="btn btn-block" onclick={create}>
        <Icon name="plus" size={20} />
        {t('workout.createCustom', { name: query.trim() })}
      </button>
    {/if}
  </div>
</Sheet>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 12px;
  }
  .input {
    font-size: 16px;
  }
  h3.section-title {
    margin: 8px 4px 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .badge {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
  }
  .future {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 4px 0 6px;
  }
  .future .label {
    margin: 0 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .future p {
    margin: 0 4px;
  }
</style>
