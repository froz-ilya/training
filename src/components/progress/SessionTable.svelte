<script lang="ts">
  import NoteChips from '../notes/NoteChips.svelte';
  import { isTimed, sessionCells } from '../../lib/coach/overview';
  import { comparableBefore, workSets, type Session, type SessionSet } from '../../lib/coach/strength';
  import { fmtKg, fmtSeconds, fmtSet } from '../../lib/coach/text';
  import { fmtDate, toISODate } from '../../lib/dates';
  import { fmtNumber, t } from '../../lib/i18n.svelte';
  import { fmtLevel } from '../workout/display';
  import type { Baseline, Load } from '../../lib/types';

  /**
   * Sessions newest first, one row each. Set cells share a column grid so a column reads down from
   * session to session, and a number that beat the session before stands out.
   */
  let {
    sessions,
    load,
    limit,
    baselines = [],
  }: {
    sessions: Session[];
    load: Load;
    limit?: number;
    /** Machine or gym changes: a number doesn't count as better across one. */
    baselines?: Baseline[];
  } = $props();

  const thisYear = toISODate().slice(0, 4);

  const rows = $derived(
    sessions
      .map((session, i) => ({ session, cells: sessionCells(session, comparableBefore(session, sessions[i - 1], baselines), load) }))
      .reverse()
      .slice(0, limit),
  );

  const anyFailure = $derived(rows.some(({ cells }) => cells.some((c) => c.set.failure)));
  /** With every set at failure a mark on each one says nothing, so one line says it instead. */
  const allFailure = $derived(rows.every(({ cells }) => cells.every((c) => c.set.failure)));
  const marked = $derived(anyFailure && !allFailure);

  function setText(set: SessionSet): string {
    const parts = [fmtSet(set, load)];
    if (isTimed(set, load) && set.weightKg > 0) parts.push(`+${fmtKg(set.weightKg)}`);
    if (set.level !== undefined) parts.push(fmtLevel(set.level));
    if (set.failure) parts.push(t('exercise.failure'));
    return parts.join(' · ');
  }

  function summary(session: Session): string {
    return `${fmtDate(session.date)}: ${workSets(session).map(setText).join(', ')}`;
  }
</script>

<div class="list">
  {#each rows as { session, cells } (session.workoutId)}
    <a class="list-item session" href="#/workout/{session.workoutId}">
      <span class="date">
        <span class="day">{fmtDate(session.date, { day: 'numeric', month: 'short' })}</span>
        {#if !session.date.startsWith(thisYear)}<span class="year">{session.date.slice(0, 4)}</span>{/if}
      </span>
      <span class="cells" role="img" aria-label={summary(session)}>
        {#each cells as { set, better }, i (i)}
          <span class="cell">
            {#if isTimed(set, load)}
              <b class:up={better === 'time'}>{fmtSeconds(set.seconds ?? 0)}{#if set.failure && marked}<i class="failure-mark">{t('exercise.failureShort')}</i>{/if}</b>
              {#if set.weightKg > 0}<span class="reps">+{fmtNumber(set.weightKg)}</span>{/if}
            {:else}
              {#if set.weightKg > 0}
                <b class:up={better === 'weight'}>{load === 'body' ? '+' : ''}{fmtNumber(set.weightKg)}</b>
              {:else if set.level !== undefined}
                <b>{fmtLevel(set.level)}</b>
              {/if}
              <span class="reps" class:up={better === 'reps'}>×{fmtNumber(set.reps)}{#if set.failure && marked}<i class="failure-mark">{t('exercise.failureShort')}</i>{/if}</span>
              {#if set.weightKg > 0 && set.level !== undefined}
                <span class="level">{fmtLevel(set.level)}</span>
              {/if}
            {/if}
          </span>
        {/each}
      </span>
      {#if session.notes}
        <span class="note"><NoteChips notes={session.notes} /></span>
      {/if}
    </a>
  {/each}
</div>
{#if anyFailure}<p class="muted small legend">{marked ? t('exercise.failureLegend') : t('exercise.failureAll')}</p>{/if}

<style>
  .session {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    column-gap: 10px;
    row-gap: 8px;
    align-items: start;
  }
  .date {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .day {
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
  }
  .year {
    font-size: 13px;
    color: var(--muted);
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(54px, 1fr));
    gap: 8px 4px;
  }
  .cell {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
    line-height: 1.25;
  }
  .cell b {
    font-size: 16px;
    font-weight: 700;
    color: var(--text);
  }
  .reps {
    font-size: 15px;
    color: var(--text-2);
  }
  .cell .up {
    color: var(--good);
    font-weight: 700;
  }
  .level {
    font-size: 12px;
    color: var(--muted);
  }
  .legend {
    margin: 6px 4px 0;
  }
  .note {
    grid-column: 1 / -1;
  }
  .note :global(.chips) {
    font-size: 14px;
    color: var(--text-2);
  }
</style>
