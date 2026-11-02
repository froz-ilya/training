<script lang="ts">
  import BodyMap from '../progress/BodyMap.svelte';
  import { regionLevels, type RegionWork } from '../../lib/catalog/regions';
  import { t } from '../../lib/i18n.svelte';
  import type { BodyRegion } from '../../lib/types';
  import { nameList } from '../../lib/workout/title';

  /** What an exercise or a workout works, on the figure from Progress. With no regions, nothing shows. */
  let { work, label, note }: { work: RegionWork; label: string; note?: string } = $props();

  const names = (regions: BodyRegion[]) => nameList(regions.map((region) => t(`exercises.region.${region}`)));
</script>

{#if work.main.length || work.helpers.length}
  <div class="card muscles">
    <div class="map"><BodyMap levels={regionLevels(work)} {label} /></div>
    <div class="legend">
      {#if work.main.length}
        <p class="small"><i class="dot main"></i>{t('exercise.muscles.main', { regions: names(work.main) })}</p>
      {/if}
      {#if work.helpers.length}
        <p class="small"><i class="dot helper"></i>{t('exercise.muscles.helpers', { regions: names(work.helpers) })}</p>
      {/if}
    </div>
    {#if note}
      <p class="muted small note">{note}</p>
    {/if}
  </div>
{/if}

<style>
  .muscles {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 16px;
  }
  /* Between the photo and the status card, so the full width would push the status off the screen. */
  .map {
    width: 100%;
    max-width: 240px;
    margin: 0 auto;
  }
  .legend {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .legend p {
    display: flex;
    gap: 8px;
    margin: 0;
  }
  .dot {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    margin-top: 5px;
    border-radius: 50%;
  }
  .dot.main {
    background: var(--body-main);
  }
  .dot.helper {
    background: var(--body-helper);
  }
  .note {
    margin: 0;
  }
</style>
