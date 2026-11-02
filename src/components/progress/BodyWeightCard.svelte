<script lang="ts">
  import Icon from '../Icon.svelte';
  import { weightChangeText } from '../../lib/bodyWeight';
  import { fmtKg } from '../../lib/coach/text';
  import { fmtDate } from '../../lib/dates';
  import { db } from '../../lib/db/schema';
  import { t } from '../../lib/i18n.svelte';
  import { live } from '../../lib/live.svelte';

  const log = live(() => db.bodyWeights.orderBy('date').toArray());
  const entries = $derived(log.value ?? []);
  const latest = $derived(entries[entries.length - 1]);
</script>

<div class="section">
  <div class="section-title">{t('progress.weight')}</div>
  <div class="list">
    <a class="list-item" href="#/body">
      <span class="body">
        {#if latest}
          <span class="title">{fmtKg(latest.kg)}</span>
          <span class="sub">{weightChangeText(entries) || fmtDate(latest.date)}</span>
        {:else}
          <span class="title">{t('progress.weight.log')}</span>
          <span class="sub">{t('progress.weight.empty')}</span>
        {/if}
      </span>
      <span class="go"><Icon name="chevron" size={16} /></span>
    </a>
  </div>
</div>

<style>
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .go {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--faint);
  }
</style>
