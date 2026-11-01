<script lang="ts">
  import Icon, { type IconName } from '../Icon.svelte';
  import type { ExerciseState } from '../../lib/coach/status';
  import { stateLabel } from '../../lib/coach/text';
  import { t } from '../../lib/i18n.svelte';

  /** Status as an icon and a word, so colour is never the only signal. */
  let { state, asking = false }: { state: ExerciseState; asking?: boolean } = $props();

  const ICONS: Record<ExerciseState, IconName> = {
    new: 'sparkle',
    progressing: 'chart',
    holding: 'minus',
    stalled: 'minus',
    dropping: 'chevron',
    returning: 'refresh',
  };
</script>

<span class="status {asking ? 'asking' : state}">
  {#if asking}
    <Icon name="swap" size={14} />{t('progress.machineQuestion')}
  {:else}
    <Icon name={ICONS[state]} size={14} />{stateLabel(state)}
  {/if}
</span>

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--text-2);
    background: var(--surface-2);
    white-space: nowrap;
  }
  .progressing {
    color: var(--good-strong);
    background: color-mix(in srgb, var(--good) 14%, transparent);
  }
  .stalled,
  .asking {
    color: var(--accent-strong);
    background: var(--accent-soft);
  }
  .dropping {
    color: var(--warn-strong);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }
</style>
