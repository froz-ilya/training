<script lang="ts">
  import type { CalendarDay } from '../../lib/coach/summary';
  import { fmtDate } from '../../lib/dates';
  import { t } from '../../lib/i18n.svelte';

  /** Weeks as columns, Monday on top; tapping a day names it. */
  let { weeks }: { weeks: CalendarDay[][] } = $props();

  let picked = $state<CalendarDay | null>(null);
</script>

<div class="calendar" style:--columns={weeks.length} role="group" aria-label={t('progress.calendar')}>
  {#each weeks as week, w (w)}
    {#each week as day (day.date)}
      {#if day.future}
        <span class="cell"></span>
      {:else}
        <button
          class="cell day"
          class:trained={day.trained}
          class:picked={picked?.date === day.date}
          aria-label="{fmtDate(day.date)}: {day.trained ? t('progress.calendarTrained') : t('progress.calendarRest')}"
          onclick={() => (picked = picked?.date === day.date ? null : day)}
        ></button>
      {/if}
    {/each}
  {/each}
</div>
<div class="legend small muted">
  {#if picked}
    <span>{fmtDate(picked.date)}: {picked.trained ? t('progress.calendarTrained') : t('progress.calendarRest')}</span>
  {:else}
    <span><i class="key trained"></i>{t('progress.calendarTrained')}</span>
    <span><i class="key"></i>{t('progress.calendarRest')}</span>
  {/if}
</div>

<style>
  .calendar {
    display: grid;
    grid-auto-flow: column;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    grid-template-rows: repeat(7, auto);
    gap: 2px;
  }
  .cell {
    aspect-ratio: 1;
    border-radius: 2px;
    padding: 0;
    border: 0;
    min-width: 0;
    display: block;
  }
  .day {
    background: var(--surface-2);
    cursor: pointer;
  }
  .day.trained {
    background: var(--accent-bar);
  }
  .day.picked {
    outline: 2px solid var(--text);
    outline-offset: 0;
  }
  .legend {
    display: flex;
    gap: 14px;
    margin-top: 8px;
    min-height: 20px;
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .key {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: var(--surface-2);
    display: inline-block;
  }
  .key.trained {
    background: var(--accent-bar);
  }
</style>
