<script lang="ts" module>
  import type { ExerciseNote } from '../../lib/types';

  /** What a comment is about, and the comment already there. */
  export interface NoteTarget {
    workoutId: string;
    exerciseId: string;
    date: string;
    setId?: string;
    note?: ExerciseNote;
  }
</script>

<script lang="ts">
  import Sheet from '../Sheet.svelte';
  import { saveNote } from '../../lib/db/repo';
  import { t } from '../../lib/i18n.svelte';
  import { BUILT_IN_TAGS } from '../../lib/notes/tags';
  import { tagLabel } from '../../lib/notes/text';
  import { settings } from '../../lib/settings.svelte';

  /** Tags and free text for one exercise, or one set when the target has a `setId`. */
  let { open = $bindable(false), target }: { open?: boolean; target: NoteTarget } = $props();

  const note = $derived(target.note);
  const tagIds = $derived([...BUILT_IN_TAGS, ...settings.customTags.map((c) => c.id)]);
  // A tag deleted from Settings stays selectable here, so saving doesn't silently drop it.
  const shown = $derived([...tagIds, ...(note?.tags.filter((tag) => !tagIds.includes(tag)) ?? [])]);

  let picked = $state<string[]>([]);
  let text = $state('');

  $effect(() => {
    picked = [...(target.note?.tags ?? [])];
    text = target.note?.text ?? '';
  });

  function toggle(tag: string) {
    picked = picked.includes(tag) ? picked.filter((p) => p !== tag) : [...picked, tag];
  }

  async function save() {
    const labels: Record<string, string> = { ...note?.labels };
    for (const custom of settings.customTags) if (picked.includes(custom.id)) labels[custom.id] = custom.label;
    await saveNote({
      id: note?.id,
      workoutId: target.workoutId,
      exerciseId: target.exerciseId,
      date: target.date,
      setId: target.setId,
      tags: $state.snapshot(picked),
      text,
      labels: Object.keys(labels).length ? labels : undefined,
    });
    open = false;
  }

  async function remove() {
    picked = [];
    text = '';
    await save();
  }
</script>

<Sheet bind:open title={target.setId ? t('notes.title.set') : t('notes.title.exercise')}>
  <div class="form">
    <div class="tags" role="group" aria-label={t('notes.tags')}>
      {#each shown as tag (tag)}
        <button type="button" class="tag" class:on={picked.includes(tag)} aria-pressed={picked.includes(tag)} onclick={() => toggle(tag)}>
          {tagLabel(tag, settings.customTags, note)}
        </button>
      {/each}
    </div>
    <textarea class="input" rows="2" aria-label={t('notes.text')} placeholder={t('notes.placeholder')} bind:value={text}></textarea>
    <p class="muted small">{t('notes.hint')}</p>
    <button type="button" class="btn btn-primary btn-block" onclick={save}>{t('common.save')}</button>
    {#if note}
      <button type="button" class="btn btn-ghost btn-block" onclick={remove}>{t('notes.remove')}</button>
    {/if}
  </div>
</Sheet>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 12px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tag {
    min-height: 38px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      opacity var(--dur-fast) var(--ease);
  }
  .tag.on {
    background: var(--accent-fill);
    color: var(--accent-text);
  }
  textarea {
    resize: none;
    font-size: 16px;
  }
</style>
