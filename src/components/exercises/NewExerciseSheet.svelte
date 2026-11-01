<script lang="ts">
  import Sheet from '../Sheet.svelte';
  import { MUSCLES } from '../../lib/catalog/exercises';
  import { createCustomExercise } from '../../lib/catalog/custom';
  import { db } from '../../lib/db/schema';
  import { t } from '../../lib/i18n.svelte';
  import { showToast } from '../../lib/ui/dialogs.svelte';
  import type { Equipment, Exercise, Load, Muscle } from '../../lib/types';

  /** Form for an exercise of the user's own. `onadded` receives it once it's saved. */
  let { open = $bindable(false), onadded }: { open?: boolean; onadded?: (exercise: Exercise) => void } = $props();

  const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'smith', 'bodyweight', 'other'];
  const LOADS: Load[] = ['weight', 'body', 'time'];

  let en = $state('');
  let de = $state('');
  let ru = $state('');
  let muscle = $state<Muscle>('chest');
  let equipment = $state<Equipment>('machine');
  let load = $state<Load>('weight');

  const canSave = $derived(!!(en.trim() || de.trim() || ru.trim()));

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!canSave) return;
    const exercise = createCustomExercise({ names: { en, de, ru }, muscle, equipment, load });
    await db.customExercises.add(exercise);
    open = false;
    en = de = ru = '';
    showToast(t('exercises.form.added'));
    onadded?.(exercise);
  }
</script>

<Sheet bind:open title={t('exercises.add')}>
  <form class="stack" onsubmit={save}>
    <label class="field">
      <span class="label">{t('exercises.form.nameRu')}</span>
      <input class="input" bind:value={ru} lang="ru" />
    </label>
    <label class="field">
      <span class="label">{t('exercises.form.nameEn')}</span>
      <input class="input" bind:value={en} lang="en" />
    </label>
    <label class="field">
      <span class="label">{t('exercises.form.nameDe')}</span>
      <input class="input" bind:value={de} lang="de" />
    </label>
    <p class="muted small">{t('exercises.form.namesHint')}</p>
    <label class="field">
      <span class="label">{t('exercises.form.muscle')}</span>
      <select class="input" bind:value={muscle}>
        {#each MUSCLES as id (id)}
          <option value={id}>{t(`exercises.muscle.${id}`)}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span class="label">{t('exercises.form.equipment')}</span>
      <select class="input" bind:value={equipment}>
        {#each EQUIPMENT as id (id)}
          <option value={id}>{t(`exercises.equipment.${id}`)}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span class="label">{t('exercises.form.load')}</span>
      <select class="input" bind:value={load}>
        {#each LOADS as id (id)}
          <option value={id}>{t(`exercises.load.${id}`)}</option>
        {/each}
      </select>
    </label>
    <button class="btn btn-primary btn-block" type="submit" disabled={!canSave}>{t('common.save')}</button>
  </form>
</Sheet>
