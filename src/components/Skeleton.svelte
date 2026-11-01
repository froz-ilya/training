<script lang="ts">
  import { t } from '../lib/i18n.svelte';

  /**
   * Pulsing placeholder lines while content loads. They wait a moment before showing, so a quick
   * load doesn't flash them.
   */
  let { lines = 3 }: { lines?: number } = $props();

  const WIDTHS = [92, 76, 84, 60, 70];
</script>

<div class="skeleton" aria-busy="true" aria-label={t('shell.loading')}>
  {#each { length: lines } as _, i}
    <span class="line" style:width="{i === lines - 1 && lines > 1 ? 45 : WIDTHS[i % WIDTHS.length]}%"></span>
  {/each}
</div>

<style>
  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 0;
    animation: appear var(--dur-fast) var(--ease) 140ms backwards;
  }
  .line {
    display: block;
    height: 14px;
    border-radius: 7px;
    background: var(--surface-2);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .line {
      animation: none;
    }
  }
</style>
