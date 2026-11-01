<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { back } from '../lib/router.svelte';
  import { t } from '../lib/i18n.svelte';

  /**
   * Page header. `backTo` shows a back chevron (navigates back, falling back to that path).
   * `actions` renders on the right (icon buttons).
   */
  let {
    title,
    subtitle = '',
    backTo,
    actions,
  }: { title: string; subtitle?: string; backTo?: string; actions?: Snippet } = $props();

  /** Exercise names run long, most of all in German and Russian: they step down in size and wrap. */
  const length = $derived(title.length > 30 ? 'long' : title.length > 16 ? 'medium' : undefined);
</script>

<header class="header">
  {#if backTo !== undefined}
    <button class="icon-btn back" aria-label={t('common.back')} onclick={() => back(backTo)}><Icon name="back" /></button>
  {/if}
  <div class="titles">
    <h1 class={length}>{title}</h1>
    {#if subtitle}<div class="muted small">{subtitle}</div>{/if}
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 52px;
    margin: 0 -8px 8px;
  }
  .titles {
    flex: 1;
    min-width: 0;
    padding: 0 8px;
  }
  h1 {
    font-size: 30px;
    font-weight: 900;
    letter-spacing: -0.015em;
    overflow-wrap: break-word;
    hyphens: auto;
    text-wrap: balance;
  }
  h1.medium {
    font-size: 25px;
  }
  h1.long {
    font-size: 21px;
  }
  .titles :global(.small) {
    margin-top: 1px;
  }
  .actions {
    display: flex;
    gap: 2px;
  }
  .back {
    margin-right: -4px;
  }
</style>
