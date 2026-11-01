<script lang="ts" module>
  export interface TrendPoint {
    date: string;
    /** Main line: estimated strength, or duration for timed exercises. */
    value: number;
    /** Heaviest set of the session, drawn as dots; left out for bodyweight and timed work. */
    top?: number;
    /** Tooltip text for the session's best set. */
    label: string;
  }
</script>

<script lang="ts">
  import { fmtDate, fromISODate } from '../../lib/dates';
  import { fmtNumber, t } from '../../lib/i18n.svelte';

  /**
   * One axis in kg (or seconds): the line is the estimate, the dots the heaviest set. Hover or
   * touch shows a session; the sessions list on the page is the table view of the same data.
   */
  let {
    points,
    lineLabel,
    dotLabel,
    changes = [],
    format = fmtNumber,
    summary,
  }: {
    points: TrendPoint[];
    lineLabel: string;
    dotLabel?: string;
    changes?: string[];
    format?: (value: number) => string;
    summary: string;
  } = $props();

  type Range = '6m' | '1y' | 'all';
  const MONTHS: Record<Exclude<Range, 'all'>, number> = { '6m': 6, '1y': 12 };
  const HEIGHT = 200;
  const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

  let range = $state<Range>('1y');
  let width = $state(0);
  let active = $state<number | null>(null);

  const shown = $derived.by(() => {
    if (range === 'all' || !points.length) return points;
    const from = fromISODate(points[points.length - 1].date);
    from.setMonth(from.getMonth() - MONTHS[range]);
    const list = points.filter((p) => fromISODate(p.date) >= from);
    return list.length >= 2 ? list : points;
  });

  const times = $derived(shown.map((p) => fromISODate(p.date).getTime()));
  const plotW = $derived(Math.max(0, width - PAD.left - PAD.right));
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  /** A clean step for about four gridlines. */
  function niceStep(span: number): number {
    const raw = span / 4;
    const power = 10 ** Math.floor(Math.log10(raw || 1));
    const unit = raw / power;
    return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
  }

  const scale = $derived.by(() => {
    const values = shown.flatMap((p) => (p.top !== undefined ? [p.value, p.top] : [p.value]));
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const step = niceStep(hi - lo || hi || 1);
    const min = Math.max(0, Math.floor(lo / step) * step);
    const max = Math.ceil(hi / step) * step || step;
    const ticks: number[] = [];
    for (let v = min; v <= max + step / 2; v += step) ticks.push(v);
    return { min, max: max === min ? min + step : max, ticks };
  });

  const x = (i: number) => {
    const first = times[0];
    const span = times[times.length - 1] - first;
    return PAD.left + (span ? ((times[i] - first) / span) * plotW : plotW / 2);
  };
  const y = (v: number) => PAD.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;

  const line = $derived(shown.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' '));
  const changeLines = $derived.by(() => {
    if (times.length < 2) return [];
    const first = times[0];
    const last = times[times.length - 1];
    return changes
      .map((d) => fromISODate(d).getTime())
      .filter((time) => time > first && time <= last)
      .map((time) => PAD.left + ((time - first) / (last - first)) * plotW);
  });

  /** Year labels when the range spans years, otherwise months. */
  const xLabels = $derived.by(() => {
    if (shown.length < 2 || plotW < 80) return [];
    const start = shown[0].date;
    const end = shown[shown.length - 1].date;
    const opts: Intl.DateTimeFormatOptions = { month: 'short', year: '2-digit' };
    return [
      { x: PAD.left, text: fmtDate(start, opts), anchor: 'start' },
      { x: PAD.left + plotW, text: fmtDate(end, opts), anchor: 'end' },
    ];
  });

  function pick(e: PointerEvent) {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = 0;
    let gap = Infinity;
    shown.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    active = best;
  }

  const current = $derived(active !== null ? shown[active] : null);
  const tipLeft = $derived(active !== null ? Math.max(4, Math.min(x(active) - 80, width - 164)) : 0);
</script>

<div class="trend">
  <div class="top">
    <div class="legend">
      <span><i class="key line"></i>{lineLabel}</span>
      {#if dotLabel}<span><i class="key dot"></i>{dotLabel}</span>{/if}
      {#if changeLines.length}<span><i class="key change"></i>{t('exercise.chart.change')}</span>{/if}
    </div>
  </div>
  <div class="segmented" role="group">
    {#each ['6m', '1y', 'all'] as const as r (r)}
      <button class:active={range === r} onclick={() => ((range = r), (active = null))}>{t(`exercise.range.${r}`)}</button>
    {/each}
  </div>

  <div class="plot" bind:clientWidth={width}>
    {#if width > 0}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <svg
        {width}
        height={HEIGHT}
        role="img"
        aria-label={summary}
        onpointermove={pick}
        onpointerdown={pick}
        onpointerleave={(e) => e.pointerType === 'mouse' && (active = null)}
      >
        {#each scale.ticks as tick (tick)}
          <line class="grid" x1={PAD.left} x2={PAD.left + plotW} y1={y(tick)} y2={y(tick)} />
          <text class="axis" x={PAD.left - 6} y={y(tick) + 4} text-anchor="end">{format(tick)}</text>
        {/each}
        {#each xLabels as label (label.anchor)}
          <text class="axis" x={label.x} y={HEIGHT - 6} text-anchor={label.anchor}>{label.text}</text>
        {/each}
        {#each changeLines as cx (cx)}
          <line class="change-line" x1={cx} x2={cx} y1={PAD.top} y2={PAD.top + plotH} />
        {/each}
        {#if active !== null}
          <line class="cross" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} />
        {/if}
        <path class="series-line" d={line} />
        {#each shown as p, i (p.date + i)}
          {#if p.top !== undefined}
            <circle class="series-dot" class:on={active === i} cx={x(i)} cy={y(p.top)} r="4" />
          {/if}
        {/each}
        {#if shown.length}
          {@const end = shown.length - 1}
          <circle class="series-end" cx={x(end)} cy={y(shown[end].value)} r="4" />
        {/if}
        {#if active !== null && current}
          <circle class="series-end" cx={x(active)} cy={y(current.value)} r="5" />
        {/if}
      </svg>
      {#if current}
        <div class="tip" style:left="{tipLeft}px">
          <b>{fmtDate(current.date)}</b>
          <span>{current.label}</span>
          <span class="muted">{lineLabel}: {format(current.value)}</span>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .trend {
    --series-a: var(--accent);
    --series-b: #86a8ff;
  }
  :global(html[data-theme='light']) .trend {
    --series-b: #3f63c7;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 13px;
    color: var(--text-2);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .key {
    display: inline-block;
    flex-shrink: 0;
  }
  .key.line {
    width: 16px;
    height: 2px;
    border-radius: 1px;
    background: var(--series-a);
  }
  .key.dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--series-b);
  }
  .key.change {
    width: 1px;
    height: 12px;
    background: var(--muted);
  }
  .segmented {
    margin: 10px 0 8px;
  }
  .plot {
    position: relative;
    min-height: 200px;
  }
  svg {
    display: block;
    touch-action: pan-y;
  }
  .grid {
    stroke: var(--border);
    stroke-width: 1;
  }
  .axis {
    fill: var(--muted);
    font-size: 11px;
  }
  .change-line {
    stroke: var(--muted);
    stroke-width: 1;
  }
  .cross {
    stroke: var(--muted);
    stroke-width: 1;
    opacity: 0.6;
  }
  .series-line {
    fill: none;
    stroke: var(--series-a);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .series-dot {
    fill: var(--series-b);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .series-end {
    fill: var(--series-a);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .tip {
    position: absolute;
    top: 0;
    width: 160px;
    padding: 6px 10px;
    border-radius: var(--radius-xs);
    background: var(--surface-raised);
    box-shadow: var(--shadow-lg);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    pointer-events: none;
  }
  .tip b {
    font-weight: 700;
  }
</style>
