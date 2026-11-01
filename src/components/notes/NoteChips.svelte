<script lang="ts">
  import { tagLabel } from '../../lib/notes/text';
  import { settings } from '../../lib/settings.svelte';
  import type { ExerciseNote } from '../../lib/types';

  /** Saved comments in a quiet line: tags as chips, then the text. Tapping edits when `onedit` is given. */
  let { notes, onedit }: { notes: ExerciseNote[]; onedit?: () => void } = $props();
</script>

{#snippet content()}
  {#each notes as note (note.id)}
    {#each note.tags as tag (tag)}
      <span class="tag">{tagLabel(tag, settings.customTags, note)}</span>
    {/each}
    {#if note.text}<span class="text">{note.text}</span>{/if}
  {/each}
{/snippet}

{#if onedit}
  <button type="button" class="chips edit" onclick={onedit}>{@render content()}</button>
{:else}
  <span class="chips">{@render content()}</span>
{/if}

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    line-height: 1.3;
    color: var(--muted);
    text-align: left;
  }
  .edit {
    padding: 2px 0;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .tag {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-2);
    font-weight: 600;
  }
  .text {
    overflow-wrap: anywhere;
  }
</style>
