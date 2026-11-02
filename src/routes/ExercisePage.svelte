<script lang="ts">
  import { onMount } from 'svelte';
  import Header from '../components/Header.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import ExercisePhotoCard from '../components/exercises/ExercisePhotoCard.svelte';
  import MuscleCard from '../components/exercises/MuscleCard.svelte';
  import PlateauOptions from '../components/coach/PlateauOptions.svelte';
  import SetSuggestion from '../components/coach/SetSuggestion.svelte';
  import StatusChip from '../components/coach/StatusChip.svelte';
  import SessionTable from '../components/progress/SessionTable.svelte';
  import TrendChart, { type TrendPoint } from '../components/progress/TrendChart.svelte';
  import {
    addBaseline,
    loadExerciseView,
    removeBaseline,
    saveExerciseSettings,
    syncStallOutcomes,
    type ExerciseView,
  } from '../lib/coach/data';
  import { weightOn } from '../lib/bodyWeight';
  import { difficultyOf } from '../lib/catalog/difficulty';
  import { photoOf } from '../lib/catalog/photos';
  import { regionsOf } from '../lib/catalog/regions';
  import { needsOptions } from '../lib/coach/plateau';
  import { markSameMachine } from '../lib/coach/sameMachine';
  import { bodyKg, repRange, sessionStrength, topSet, weightStep } from '../lib/coach/strength';
  import { exerciseRecords } from '../lib/coach/summary';
  import { fmtKg, fmtSeconds, fmtSet, statusText } from '../lib/coach/text';
  import { fmtDate } from '../lib/dates';
  import { db } from '../lib/db/schema';
  import { nameOf } from '../lib/exercises.svelte';
  import { fmtNumber, t, tn } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { route } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';
  import { confirmAction } from '../lib/ui/dialogs.svelte';
  import type { Lang } from '../lib/types';

  /** Sessions listed before "Show all". */
  const RECENT = 8;
  const LANGUAGES: Lang[] = ['en', 'de', 'ru'];
  const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', de: 'Deutsch', ru: 'Русский' };

  const id = route.parts[1] ?? '';
  const data = live(() => loadExerciseView(id));
  const weighIns = live(() => db.bodyWeights.orderBy('date').toArray());
  onMount(() => void syncStallOutcomes());

  let showAll = $state(false);
  /** The user just answered the machine question; the query below doesn't watch localStorage. */
  let answered = $state(false);

  const view = $derived(data.value ?? null);
  const body = $derived(bodyKg(settings.bodyWeightKg));
  /** The chart and records read each session at what the user weighed that day. */
  const bodyOn = (date: string) => weightOn(weighIns.value ?? [], date) ?? body;
  const isTime = $derived(view?.exercise.load === 'time');
  const isBody = $derived(view?.exercise.load === 'body');
  const photo = $derived(view ? photoOf(view.exercise.id) : undefined);

  const chartPoints = $derived.by((): TrendPoint[] => {
    if (!view) return [];
    const { load } = view.exercise;
    const points: TrendPoint[] = [];
    for (const session of view.sessions) {
      const value = sessionStrength(session, load, bodyOn(session.date));
      const top = topSet(session);
      if (value === null || !top) continue;
      points.push({
        date: session.date,
        value: Math.round(value * 10) / 10,
        top: load === 'weight' ? top.weightKg : undefined,
        label: fmtSet(top, load),
      });
    }
    return points;
  });

  /** Records follow what's compared: another level or machine isn't the same number. */
  const records = $derived(view ? exerciseRecords(view.compared, view.exercise.load, bodyOn) : null);
  /** The heading explains the numbers once, so the table doesn't repeat kg in every cell. */
  const showUnit = $derived(!isTime && !!view?.sessions.some((s) => s.sets.some((set) => set.weightKg > 0)));
  const range = $derived(view ? repRange(view.exercise, view.setting, view.compared) : null);
  const autoStep = $derived(view ? weightStep(view.exercise, view.compared) : 0);
  const lastChart = $derived(chartPoints[chartPoints.length - 1]);
  /** A bodyweight exercise has no machine to set, unless the user already noted something here. */
  const showMachine = $derived(view?.exercise.equipment !== 'bodyweight' || !!view?.setting?.machineSetting);
  const formatValue = (value: number) => (isTime ? fmtSeconds(value) : fmtNumber(Math.round(value)));
  /** Don't suggest wins, whatever else a row holds. */
  const suggesting = $derived(view?.setting?.avoid ? 'no' : view?.setting?.sometimes ? 'sometimes' : 'yes');

  async function restart() {
    if (!view) return;
    if (await confirmAction({ title: t('exercise.change.confirm'), message: t('exercise.change.text') })) {
      await addBaseline(view.exercise.id);
    }
  }

  function sameMachine() {
    if (!view) return;
    markSameMachine(view.exercise.id);
    answered = true;
  }

  function positive(value: string): number | undefined {
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  function save(field: 'stepKg' | 'repLow' | 'repHigh', value: string) {
    if (view) void saveExerciseSettings(view.exercise.id, { [field]: positive(value) });
  }
</script>

<div class="page">
  {#if data.value === undefined}
    <Header title="" backTo="/exercises" />
    <Skeleton />
  {:else if !view}
    <Header title="" backTo="/exercises" />
    <p class="empty">{t('exercise.notFound')}</p>
  {:else}
    <Header title={nameOf(view.exercise)} backTo="/exercises" />

    {#if photo}<ExercisePhotoCard {photo} name={nameOf(view.exercise)} />{/if}
    <MuscleCard
      work={regionsOf(view.exercise)}
      label={t('exercise.muscles.map')}
      note={view.exercise.id.startsWith('custom-') ? t('exercise.muscles.estimate') : undefined}
    />
    <div class="card difficulty">
      <b class="small">{t(`exercise.difficulty.${difficultyOf(view.exercise)}`)}</b>
      <p class="muted small flat">
        {t(view.exercise.id.startsWith('custom-') ? 'exercise.difficulty.estimate' : 'exercise.difficulty.note')}
      </p>
    </div>

    {#if view.sessions.length}
      <div class="card status">
        <StatusChip state={view.status.state} asking={view.status.maybeMachineChange && !answered} />
        <p class="small">{statusText(view.status, view.compared.length)}</p>
        {#if view.status.maybeMachineChange && !answered}
          <div class="question">
            <b>{t('coach.machine.title')}</b>
            <p class="muted small">{t('coach.machine.text')}</p>
            <div class="row">
              <button class="btn" onclick={restart}>{t('coach.machine.yes')}</button>
              <button class="btn btn-ghost" onclick={sameMachine}>{t('coach.machine.no')}</button>
            </div>
          </div>
        {/if}
      </div>

      {#if view.suggestion}
        <div class="section"><div class="card"><SetSuggestion exerciseId={view.exercise.id} /></div></div>
      {/if}

      {#if needsOptions(view.status)}<PlateauOptions {view} />{/if}

      <div class="section">
        <div class="section-title">{t('exercise.chart')}</div>
        <div class="card">
          {#if chartPoints.length >= 2}
            <TrendChart
              points={chartPoints}
              lineLabel={isTime ? t('exercise.chart.time') : isBody ? t('exercise.chart.strengthBody') : t('exercise.chart.strength')}
              dotLabel={view.exercise.load === 'weight' ? t('exercise.chart.top') : undefined}
              changes={view.baselines.map((b) => b.date)}
              format={formatValue}
              summary={t('exercise.chart.summary', { sessions: tn('common.workouts', chartPoints.length), value: formatValue(lastChart.value) })}
            />
          {:else}
            <p class="muted small flat">{t('exercise.chart.empty')}</p>
          {/if}
        </div>
      </div>

      {#if records}
        <div class="section">
          <div class="section-title">{t('exercise.records')}</div>
          <div class="tiles">
            {#if isTime}
              {#if records.bestEstimate > 0}
                <div class="card tile">
                  <b>{fmtSeconds(Math.round(records.bestEstimate))}</b>
                  <span class="muted small">{t('exercise.record.longest')}</span>
                </div>
              {/if}
            {:else}
              {#if records.heaviest}
                <div class="card tile">
                  <b>{fmtSet(records.heaviest, view.exercise.load)}</b>
                  <span class="muted small">{t('exercise.record.heaviest')}</span>
                </div>
              {/if}
              {#if records.bestEstimate > 0}
                <div class="card tile">
                  <b>{fmtKg(Math.round(records.bestEstimate))}</b>
                  <span class="muted small">{t('exercise.record.estimate')}</span>
                </div>
              {/if}
              {#if records.mostReps > 0}
                <div class="card tile">
                  <b>{fmtNumber(records.mostReps)}</b>
                  <span class="muted small">{t('exercise.record.reps')}</span>
                </div>
              {/if}
            {/if}
            <div class="card tile">
              <b>{fmtNumber(view.sessions.length)}</b>
              <span class="muted small">{t('exercise.record.sessions')}</span>
            </div>
          </div>
        </div>
      {/if}

      <div class="section">
        <div class="section-title">
          {t('exercise.recent')}
          {#if showUnit}<span class="unit">{t('exercise.recent.unit')}</span>{/if}
        </div>
        <SessionTable sessions={view.sessions} load={view.exercise.load} baselines={view.baselines} limit={showAll ? undefined : RECENT} />
        {#if !showAll && view.sessions.length > RECENT}
          <button class="btn btn-ghost btn-block more" onclick={() => (showAll = true)}>
            {t('exercise.all', { n: view.sessions.length })}
          </button>
        {/if}
      </div>
    {/if}

    <div class="section">
      <div class="section-title">{t('exercise.settings')}</div>
      <div class="card stack">
        {#if showMachine}
          <div class="field">
            <label for="machine">{t('exercise.setting.machine')}</label>
            <input
              id="machine"
              class="input"
              placeholder={t('exercise.setting.machineHint')}
              value={view.setting?.machineSetting ?? ''}
              onchange={(e) => view && saveExerciseSettings(view.exercise.id, { machineSetting: e.currentTarget.value.trim() || undefined })}
            />
          </div>
        {/if}
        {#if !isTime && range}
          <div class="pair">
            <div class="field">
              <label for="low">{t('exercise.setting.repLow')}</label>
              <input id="low" class="input" inputmode="numeric" value={range.low} onchange={(e) => save('repLow', e.currentTarget.value)} />
            </div>
            <div class="field">
              <label for="high">{t('exercise.setting.repHigh')}</label>
              <input id="high" class="input" inputmode="numeric" value={range.high} onchange={(e) => save('repHigh', e.currentTarget.value)} />
            </div>
          </div>
          <div class="field">
            <label for="step">{t('exercise.setting.step')}</label>
            <input
              id="step"
              class="input"
              inputmode="decimal"
              placeholder={t('exercise.setting.stepAuto', { step: autoStep })}
              value={view.setting?.stepKg ?? ''}
              onchange={(e) => save('stepKg', e.currentTarget.value)}
            />
          </div>
        {/if}
        <div class="field">
          <span class="label">{t('exercise.setting.goal')}</span>
          <div class="segmented" role="group">
            <button
              class:active={view.setting?.goal !== 'maintain'}
              onclick={() => view && saveExerciseSettings(view.exercise.id, { goal: 'progress' })}
            >
              {t('exercise.goal.progress')}
            </button>
            <button
              class:active={view.setting?.goal === 'maintain'}
              onclick={() => view && saveExerciseSettings(view.exercise.id, { goal: 'maintain' })}
            >
              {t('exercise.goal.maintain')}
            </button>
          </div>
        </div>
        <div class="field">
          <span class="label" id="suggestions">{t('exercise.setting.suggestions')}</span>
          <div class="segmented" role="group" aria-labelledby="suggestions">
            <button
              class:active={suggesting === 'yes'}
              aria-pressed={suggesting === 'yes'}
              onclick={() => view && suggesting !== 'yes' && saveExerciseSettings(view.exercise.id, { avoid: undefined, sometimes: undefined })}
            >
              {t('exercise.suggest.yes')}
            </button>
            <button
              class:active={suggesting === 'sometimes'}
              aria-pressed={suggesting === 'sometimes'}
              onclick={() => view && saveExerciseSettings(view.exercise.id, { avoid: undefined, sometimes: true })}
            >
              {t('exercise.suggest.sometimes')}
            </button>
            <button
              class:active={suggesting === 'no'}
              aria-pressed={suggesting === 'no'}
              onclick={() => view && saveExerciseSettings(view.exercise.id, { avoid: true, sometimes: undefined })}
            >
              {t('exercise.suggest.no')}
            </button>
          </div>
          {#if suggesting === 'no'}
            <p class="muted small flat suggest-hint">{t('exercise.suggest.avoided')}</p>
          {:else if suggesting === 'sometimes'}
            <p class="muted small flat suggest-hint">{t('exercise.suggest.sometimesHint')}</p>
          {/if}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">{t('exercise.change')}</div>
      <div class="card stack">
        <p class="muted small flat">{t('exercise.change.text')}</p>
        {#each view.baselines as baseline (baseline.id)}
          <div class="baseline">
            <span class="small">
              {t('exercise.change.since', { date: fmtDate(baseline.date) })}{baseline.note ? ` · ${baseline.note}` : ''}
            </span>
            <button class="btn btn-ghost small-btn" onclick={() => removeBaseline(baseline.id)}>{t('exercise.change.undo')}</button>
          </div>
        {/each}
        <button class="btn" onclick={restart}>{t('exercise.change.add')}</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">{t('exercise.names')}</div>
      <div class="list">
        {#each LANGUAGES as language (language)}
          <div class="list-item static" lang={language}>
            <span class="body">
              <span class="sub">{LANGUAGE_NAMES[language]}</span>
              <span class="title">{view.exercise.names[language]}</span>
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .difficulty {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 16px;
  }
  .status {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .status p {
    margin: 0;
  }
  .question {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }
  .question p {
    margin: 0;
  }
  .question .row {
    flex-wrap: wrap;
    gap: 8px;
  }
  .flat {
    margin: 0;
  }
  .suggest-hint {
    margin-left: 4px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
  }
  .tile b {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 800;
    overflow-wrap: anywhere;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .static {
    cursor: default;
  }
  .unit {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
  }
  .more {
    margin-top: 8px;
  }
  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .baseline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .small-btn {
    min-height: 36px;
    padding: 4px 10px;
    flex-shrink: 0;
  }
</style>
