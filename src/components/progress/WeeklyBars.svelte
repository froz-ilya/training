<script lang="ts">
  import type { WeekVolume } from '../../lib/coach/summary';
  import { fmtDate } from '../../lib/dates';
  import { fmtNumber, t, tn } from '../../lib/i18n.svelte';

  /** Columns from one baseline; tapping one shows its week. */
  let { weeks }: { weeks: WeekVolume[] } = $props();

  const HEIGHT = 126;
  const LABEL = 18;
  const TOP = 16;
  const MAX_BAR = 24;

  let width = $state(0);
  let active = $state<number | null>(null);

  const max = $derived(Math.max(1, ...weeks.map((w) => w.sets)));
  const slot = $derived(width / Math.max(1, weeks.length));
  const barW = $derived(Math.min(MAX_BAR, Math.max(4, slot - 2)));
  const plotH = HEIGHT - LABEL - TOP;
  const baseline = TOP + plotH;
  const barH = (sets: number) => (sets > 0 ? Math.max(4, (sets / max) * plotH) : 0);
  const latest = $derived(weeks[weeks.length - 1]);
  const shown = $derived(active !== null ? weeks[active] : null);

  /** A column with its top corners rounded and its foot square on the baseline. */
  function bar(i: number, sets: number): string {
    const h = barH(sets);
    const r = Math.min(4, barW / 2, h);
    const left = slot * i + (slot - barW) / 2;
    const bottom = baseline;
    const top = bottom - h;
    return `M${left} ${bottom}V${top + r}Q${left} ${top} ${left + r} ${top}H${left + barW - r}Q${left + barW} ${top} ${left + barW} ${top + r}V${bottom}Z`;
  }
</script>

<div class="weekly">
  <div class="muted small line">
    {#if shown}
      {t('progress.weekOf', { date: fmtDate(shown.week, { day: 'numeric', month: 'short' }) })}: {tn('common.sets', shown.sets)}
    {:else if latest}
      {t('progress.volumeSummary', { sets: tn('common.sets', latest.sets) })}
    {/if}
  </div>
  <div class="plot" bind:clientWidth={width}>
    {#if width > 0}
      <svg {width} height={HEIGHT} role="img" aria-label={t('progress.volume')}>
        <line class="base" x1="0" x2={width} y1={baseline} y2={baseline} />
        <text class="axis" x="0" y="11">{fmtNumber(max)}</text>
        {#each weeks as week, i (week.week)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <g
            class="column"
            class:dim={active !== null && active !== i}
            onpointerenter={(e) => e.pointerType === 'mouse' && (active = i)}
            onpointerleave={(e) => e.pointerType === 'mouse' && (active = null)}
            onclick={() => (active = active === i ? null : i)}
          >
            <rect x={slot * i} y="0" width={slot} height={HEIGHT} fill="transparent" />
            {#if week.sets > 0}<path d={bar(i, week.sets)} />{/if}
          </g>
        {/each}
        <text class="axis" x="0" y={HEIGHT - 3}>{fmtDate(weeks[0].week, { day: 'numeric', month: 'short' })}</text>
        <text class="axis" x={width} y={HEIGHT - 3} text-anchor="end">{fmtDate(weeks[weeks.length - 1].week, { day: 'numeric', month: 'short' })}</text>
      </svg>
    {/if}
  </div>
</div>

<style>
  .line {
    min-height: 20px;
    margin-bottom: 6px;
  }
  .plot {
    min-height: 126px;
  }
  svg {
    display: block;
  }
  .base {
    stroke: var(--border);
    stroke-width: 1;
  }
  .column {
    cursor: pointer;
  }
  .column path {
    fill: var(--accent-bar);
    transition: opacity var(--dur-fast) var(--ease);
  }
  .column.dim path {
    opacity: 0.4;
  }
  .axis {
    fill: var(--muted);
    font-size: 11px;
  }
</style>
