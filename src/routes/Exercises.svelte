<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import NewExerciseSheet from '../components/exercises/NewExerciseSheet.svelte';
  import { MUSCLES, exerciseName, searchExercises } from '../lib/catalog/exercises';
  import { allExercises, nameLang, nameOf } from '../lib/exercises.svelte';
  import { locale, t } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { go } from '../lib/router.svelte';
  import type { Exercise, Lang, Muscle } from '../lib/types';

  const LANGS: Lang[] = ['ru', 'en', 'de'];

  let query = $state('');
  let muscle = $state<Muscle | null>(null);
  let adding = $state(false);

  const exercises = live(allExercises);

  const shown = $derived.by(() => {
    const list = (exercises.value ?? []).filter((e) => !muscle || e.muscle === muscle);
    if (query.trim()) return searchExercises(list, query);
    return [...list].sort((a, b) => nameOf(a).localeCompare(nameOf(b), locale()));
  });

  /** The exercise's name in the other languages, when they differ from the one shown. */
  function otherNames(exercise: Exercise): string {
    const main = nameOf(exercise);
    const others = LANGS.filter((l) => l !== nameLang()).map((l) => exercise.names[l]);
    return [...new Set(others)].filter((n) => n && n !== main).join(' · ');
  }
</script>

<div class="page">
  <Header title={t('exercises.title')}>
    {#snippet actions()}
      <button class="icon-btn" aria-label={t('exercises.add')} onclick={() => (adding = true)}><Icon name="plus" /></button>
    {/snippet}
  </Header>

  <input class="input" type="search" placeholder={t('exercises.search')} bind:value={query} />

  <div class="filters" role="group" aria-label={t('exercises.form.muscle')}>
    <button class="chip" class:active={!muscle} aria-pressed={!muscle} onclick={() => (muscle = null)}>{t('exercises.all')}</button>
    {#each MUSCLES as id (id)}
      <button class="chip" class:active={muscle === id} aria-pressed={muscle === id} onclick={() => (muscle = id)}>
        {t(`exercises.muscle.${id}`)}
      </button>
    {/each}
  </div>

  {#if shown.length}
    <div class="list">
      {#each shown as exercise (exercise.id)}
        <button class="list-item" onclick={() => go(`/exercise/${exercise.id}`)}>
          <span class="names">
            <span class="title">{exerciseName(exercise, nameLang())}</span>
            <span class="sub">{otherNames(exercise)}</span>
            {#if exercise.id.startsWith('custom-')}<span class="sub mine">{t('exercises.mine')}</span>{/if}
          </span>
          <Icon name="chevron" size={18} />
        </button>
      {/each}
    </div>
  {:else if exercises.value}
    <p class="empty">{t('exercises.none')}</p>
  {/if}
</div>

<NewExerciseSheet bind:open={adding} />

<style>
  .filters {
    display: flex;
    gap: 8px;
    margin: 12px -16px 16px;
    padding: 0 16px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .filters::-webkit-scrollbar {
    display: none;
  }
  .filters .chip {
    flex: none;
    border: 0;
    cursor: pointer;
    font: inherit;
  }
  .filters .chip.active {
    background: var(--accent-fill);
    color: var(--accent-text);
  }
  .names {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .mine {
    color: var(--accent);
  }
  .list-item :global(svg) {
    flex: none;
    color: var(--faint);
  }
</style>
