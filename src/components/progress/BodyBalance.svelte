<script lang="ts">
  import Sheet from '../Sheet.svelte';
  import BodyMap from './BodyMap.svelte';
  import { hasEnoughHistory, regionRange, regionStatus, type BodyLoad, type RegionStatus } from '../../lib/coach/balance';
  import { nameOf } from '../../lib/exercises.svelte';
  import { fmtNumber, t, tn } from '../../lib/i18n.svelte';
  import { saveSettings, settings } from '../../lib/settings.svelte';
  import type { BodyRegion, RegionGoal } from '../../lib/types';

  /** Where the sets go: the map, a short summary, and a sheet with the reason for a region's colour. */
  let { load }: { load: BodyLoad } = $props();

  /** Rows of the summary, in the order they read. */
  const STATUSES: RegionStatus[] = ['less', 'normal', 'more'];
  /** Choices in the sheet; the first means no goal is stored. */
  const GOALS = ['usual', 'focus', 'maintain', 'ignore'] as const;
  const SHARES_SHOWN = 6;

  let picked = $state<BodyRegion | null>(null);
  let open = $state(false);

  const enough = $derived(hasEnoughHistory(load));
  const rows = $derived(
    load.regions.map((row) => {
      const goal = settings.regionGoals[row.region];
      const status = enough ? regionStatus(row, goal) : null;
      const name = t(`exercises.region.${row.region}`);
      const sets = t('progress.body.perWeek', { sets: tn('common.sets', row.perWeek) });
      return { ...row, goal, status, name, sets, label: status ? `${name}: ${sets}, ${t(`progress.body.status.${status}`)}` : name };
    }),
  );
  const row = $derived(rows.find((r) => r.region === picked));
  const range = $derived(row && regionRange(row.region, row.goal));

  function pick(region: BodyRegion) {
    picked = region;
    open = true;
  }

  function setGoal(region: BodyRegion, goal: RegionGoal | 'usual') {
    const { [region]: _, ...others } = settings.regionGoals;
    settings.regionGoals = goal === 'usual' ? others : { ...others, [region]: goal };
    void saveSettings();
  }
</script>

<div class="card balance">
  <BodyMap regions={rows} selected={open ? picked : null} onpick={pick} />
  {#if enough}
    <div class="summary">
      {#each STATUSES as status (status)}
        {@const list = rows.filter((r) => r.status === status)}
        <div class="line">
          <span class="status"><i class="dot {status}"></i>{t(`progress.body.status.${status}`)} <span class="muted">{fmtNumber(list.length)}</span></span>
          {#if status !== 'normal' && list.length}
            <div class="chips">
              {#each list as item (item.region)}
                <button class="chip" aria-label={item.label} onclick={() => pick(item.region)}>
                  {item.name}<span class="muted">{fmtNumber(item.perWeek)}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
<p class="muted small note">{enough ? t('progress.body.note') : t('progress.body.notEnough')}</p>

<Sheet bind:open title={row?.name}>
  {#if row && range}
    <div class="stack">
      {#if row.status}
        <div>
          <div class="verdict"><i class="dot {row.status}"></i>{row.status === 'ignored' ? t('progress.body.status.ignored') : row.sets}</div>
          {#if row.status !== 'ignored'}
            <p class="muted small reason">{t(`progress.body.reason.${row.status}`, { low: fmtNumber(range.low), high: fmtNumber(range.high) })}</p>
          {/if}
        </div>
      {/if}

      <div class="field">
        <span class="label" id="region-goal">{t('progress.body.goal')}</span>
        <div class="segmented goals" role="radiogroup" aria-labelledby="region-goal">
          {#each GOALS as goal (goal)}
            {@const active = (row.goal ?? 'usual') === goal}
            <button role="radio" aria-checked={active} class:active onclick={() => setGoal(row.region, goal)}>{t(`progress.body.goal.${goal}`)}</button>
          {/each}
        </div>
        <p class="muted small reason">{t(`progress.body.goalHint.${row.goal ?? 'usual'}`)}</p>
      </div>

      <div>
        <div class="section-title">{t('progress.overview')}</div>
        {#if row.shares.length}
          <div class="list">
            {#each row.shares.slice(0, SHARES_SHOWN) as share (share.exercise.id)}
              <a class="list-item" href="#/exercise/{share.exercise.id}">
                <span class="share">
                  <span class="title">{nameOf(share.exercise)}</span>
                  <span class="sub">{tn('common.sets', share.sets)}{share.helper ? ` · ${t('progress.body.helper')}` : ''}</span>
                </span>
              </a>
            {/each}
          </div>
        {:else}
          <p class="muted small reason">{t('progress.body.noSets')}</p>
        {/if}
      </div>
    </div>
  {/if}
</Sheet>

<style>
  .balance {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .note {
    margin: 8px 4px 0;
  }
  .summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .line {
    display: flex;
    flex-direction: column;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
    font-weight: 600;
  }
  .dot {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--surface-3);
  }
  .dot.less {
    background: var(--cool);
  }
  .dot.normal {
    background: var(--good);
  }
  .dot.more {
    background: var(--warn);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0 6px;
  }
  .chip {
    border: 0;
    margin-block: 3px;
    padding: 3px 9px;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    gap: 5px;
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
  }
  .reason {
    margin: 4px 0 0;
  }
  /* Four choices share a phone's width, and German and Russian run long: each takes what its word needs. */
  .goals button {
    flex: 1 1 auto;
    padding: 0 2px;
    font-size: 13px;
  }
  .share {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
