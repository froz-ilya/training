<script lang="ts">
  import { trendDirection } from '../../lib/coach/overview';
  import { fmtNumber, t } from '../../lib/i18n.svelte';

  /** A strength change as a share. The sign or the word carries it, so colour is never the only signal. */
  let { change }: { change: number } = $props();

  const direction = $derived(trendDirection(change));
  const percent = $derived(fmtNumber(Math.round(Math.abs(change) * 100)));
</script>

<span class="pill {direction}">
  {#if direction === 'flat'}
    {t('progress.steady')}
  {:else if direction === 'up'}
    {t('progress.recordGain', { percent })}
  {:else}
    {t('progress.recordLoss', { percent })}
  {/if}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text-2);
    background: var(--surface-2);
  }
  .up {
    color: var(--good-strong);
    background: color-mix(in srgb, var(--good) 14%, transparent);
  }
  .down {
    color: var(--warn-strong);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }
</style>
