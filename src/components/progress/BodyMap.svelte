<script lang="ts">
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

  /** One neutral figure, front and back. Each region is a button; see BodyBalance for what it opens. */
  let { regions, selected, onpick }: { regions: MapRegion[]; selected: BodyRegion | null; onpick: (region: BodyRegion) => void } = $props();

  const views = $derived([
    { label: t('progress.body.front'), shapes: FRONT, x: 75 },
    { label: t('progress.body.back'), shapes: BACK, x: 225 },
  ]);
  const inFront = new Set(FRONT.map((shape) => shape.region));

  function onkeydown(e: KeyboardEvent, region: BodyRegion) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onpick(region);
  }
</script>

<svg viewBox="0 0 300 322" role="group" aria-label={t('progress.body')}>
  {#each views as view (view.x)}
    <g transform="translate({view.x} 2)">
      <path class="outline" d={OUTLINE} />
      <path class="outline" d={OUTLINE} transform="scale(-1 1)" />
      {#each view.shapes as shape (shape.region)}
        {@const row = regions.find((r) => r.region === shape.region)}
        {@const repeat = view.shapes === BACK && inFront.has(shape.region)}
        <g
          class="region {row?.status ?? ''}"
          class:selected={selected === shape.region}
          role="button"
          tabindex={repeat ? -1 : 0}
          aria-label={row?.label}
          aria-hidden={repeat || undefined}
          onclick={() => onpick(shape.region)}
          onkeydown={(e) => onkeydown(e, shape.region)}
        >
          <path d={shape.d} />
          <path d={shape.d} transform="scale(-1 1)" />
        </g>
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
</style>
