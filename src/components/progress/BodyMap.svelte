<script lang="ts">
  import type { RegionLevels } from '../../lib/catalog/regions';
  import type { RegionStatus } from '../../lib/coach/balance';
  import { t } from '../../lib/i18n.svelte';
  import type { BodyRegion } from '../../lib/types';
  import { BACK, FRONT, OUTLINE } from './bodyShapes';

  interface MapRegion {
    region: BodyRegion;
    /** Null while there's too little history to say. */
    status: RegionStatus | null;
    /** What a screen reader says for this region. */
    label: string;
  }

  type Props =
    | { regions: MapRegion[]; selected: BodyRegion | null; onpick: (region: BodyRegion) => void; levels?: undefined; label?: undefined }
    | { levels: RegionLevels; label: string; regions?: undefined; selected?: undefined; onpick?: undefined };

  /**
   * One neutral figure, front and back. With `regions`, each region is a button; see BodyBalance for
   * what it opens. With `levels`, it's a picture: nothing to tap or focus, and `label` names it.
   */
  let { regions, selected, onpick, levels, label }: Props = $props();

  const views = $derived([
    { label: t('progress.body.front'), shapes: FRONT, x: 75 },
    { label: t('progress.body.back'), shapes: BACK, x: 225 },
  ]);
  const inFront = new Set(FRONT.map((shape) => shape.region));

  function onkeydown(e: KeyboardEvent, region: BodyRegion) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onpick?.(region);
  }
</script>

<svg class:readonly={!!levels} viewBox="0 0 300 322" role={levels ? 'img' : 'group'} aria-label={label ?? t('progress.body')}>
  {#each views as view (view.x)}
    <g transform="translate({view.x} 2)">
      <path class="outline" d={OUTLINE} />
      <path class="outline" d={OUTLINE} transform="scale(-1 1)" />
      {#each view.shapes as shape (shape.region)}
        {#if levels}
          <g class="part {levels[shape.region] ?? ''}">
            <path d={shape.d} />
            <path d={shape.d} transform="scale(-1 1)" />
          </g>
        {:else}
          {@const row = regions?.find((r) => r.region === shape.region)}
          {@const repeat = view.shapes === BACK && inFront.has(shape.region)}
          <g
            class="region {row?.status ?? ''}"
            class:selected={selected === shape.region}
            role="button"
            tabindex={repeat ? -1 : 0}
            aria-label={row?.label}
            aria-hidden={repeat || undefined}
            onclick={() => onpick?.(shape.region)}
            onkeydown={(e) => onkeydown(e, shape.region)}
          >
            <path d={shape.d} />
            <path d={shape.d} transform="scale(-1 1)" />
          </g>
        {/if}
      {/each}
      <text x="0" y="316">{view.label}</text>
    </g>
  {/each}
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    max-width: 360px;
    margin: 0 auto;
    touch-action: manipulation;
  }
  .outline {
    fill: var(--surface-2);
  }
  /* The clear stroke makes thin regions easier to hit with a thumb. */
  .region path {
    fill: var(--surface-3);
    stroke: transparent;
    stroke-width: 6px;
    transition: fill var(--dur-fast) var(--ease);
  }
  .region {
    cursor: pointer;
    outline: none;
  }
  .region.less path {
    fill: var(--cool);
  }
  .region.normal path {
    fill: var(--good);
  }
  .region.more path {
    fill: var(--warn);
  }
  .region.selected path,
  .region:focus-visible path {
    stroke: var(--text);
    stroke-width: 1.5px;
  }
  text {
    fill: var(--muted);
    font-size: 13px;
    text-anchor: middle;
  }
  /* Read-only: a new class, so the button rules (pointer, hit-area stroke, focus) never apply. */
  .part path {
    fill: var(--surface-3);
  }
  .part.main path {
    fill: var(--body-main);
  }
  .part.helper path {
    fill: var(--body-helper);
  }
  /* The figure is drawn smaller here, so 15 units is 12px at 240px wide. */
  svg.readonly text {
    font-size: 15px;
  }
</style>
