<script lang="ts">
  import Icon from '../Icon.svelte';
  import Sheet from '../Sheet.svelte';
  import { searchExercises } from '../../lib/catalog/exercises';
  import { allExercises, nameOf } from '../../lib/exercises.svelte';
  import { quickCustomExercise, recentExerciseIds } from '../../lib/db/repo';
  import { t } from '../../lib/i18n.svelte';
  import type { Exercise } from '../../lib/types';

  /** Bottom sheet for choosing an exercise; search works in all three languages. */
  let { open = $bindable(false), onpick }: { open?: boolean; onpick: (exerciseId: string) => void } = $props();

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

<Sheet bind:open tall title={t('workout.pickTitle')}>
  <div class="picker">
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
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
</style>
