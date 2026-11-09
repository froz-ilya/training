<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import ExerciseCard from '../components/workout/ExerciseCard.svelte';
  import ExercisePicker from '../components/workout/ExercisePicker.svelte';
  import NoteSheet, { type NoteTarget } from '../components/notes/NoteSheet.svelte';
  import SetDock from '../components/workout/SetDock.svelte';
  import { stepFor } from '../components/workout/display';
  import { pairSets } from '../lib/coach/compare';
  import { loadPositionCost } from '../lib/coach/data';
  import { bodyKg } from '../lib/coach/strength';
  import { fmtDate } from '../lib/dates';
  import {
    activeWorkout,
    addExercise,
    addSet,
    applyPlan,
    deleteWorkout,
    effectiveHistory,
    finishWorkout,
    isStorageFull,
    lastPerformance,
    moveExercise,
    removeExercise,
    removeSet,
    repeatWorkout,
    replaceExercise,
    setMachineSetting,
    startWorkout,
    updateSet,
    updateWorkout,
    type Performance,
  } from '../lib/db/repo';
  import { mainGroups, namingSets } from '../lib/catalog/groups';
  import { db } from '../lib/db/schema';
  import { isOffDay } from '../lib/notes/tags';
  import { getExercise, nameOf } from '../lib/exercises.svelte';
  import { t, tn } from '../lib/i18n.svelte';
  import { live } from '../lib/live.svelte';
  import { collapse, dur, easeOut, MOTION, reducedMotion } from '../lib/motion';
  import { go, replace, route } from '../lib/router.svelte';
  import { settings as appSettings } from '../lib/settings.svelte';
  import type { ActionItem } from '../lib/ui/dialogs.svelte';
  import { chooseAction, confirmAction, promptText, showToast, ui, undoToast } from '../lib/ui/dialogs.svelte';
  import { groupEntries, nextOpenSet, type Entry } from '../lib/workout/entries';
  import { workoutTitle } from '../lib/workout/title';
  import type { WorkoutSet } from '../lib/types';

  const id = route.parts[1];

  const data = live(async () => {
    const workout = await db.workouts.get(id);
    if (!workout) return null;
    const rows = await db.sets.where('workoutId').equals(id).toArray();
    const entries = groupEntries(workout.status === 'done' ? await effectiveHistory(rows) : rows);
    const notes = await db.exerciseNotes.where('workoutId').equals(id).toArray();
    const details = await Promise.all(
      entries.map(async (entry) => ({
        entry,
        exercise: await getExercise(entry.exerciseId),
        settings: await db.exerciseSettings.get(entry.exerciseId),
        notes: notes.filter((n) => n.exerciseId === entry.exerciseId),
      })),
    );
    return { workout, details };
  });

  const workout = $derived(data.value?.workout);
  const details = $derived(data.value?.details ?? []);
  const entries = $derived(details.map((d) => d.entry));
  const logging = $derived(workout?.status === 'active');
  const backTo = $derived(workout?.status === 'done' ? '/history' : '/');
  const title = $derived(
    workoutTitle(
      mainGroups(
        details.flatMap(({ entry, exercise }) =>
          exercise ? [{ exercise, sets: namingSets(entry.sets) }] : [],
        ),
      ),
    ),
  );

  /** Last time per exercise; only reloaded when the exercises change, not on every set. */
  let last = $state<Record<string, Performance | null>>({});
  const exerciseKey = $derived([...new Set(entries.map((e) => e.exerciseId))].join('|'));
  const workoutDate = $derived(workout?.date);
  $effect(() => {
    const ids = exerciseKey ? exerciseKey.split('|') : [];
    const before = workoutDate;
    if (!before) return;
    void Promise.all(ids.map(async (ex) => [ex, await lastPerformance(ex, { before, excludeWorkoutId: id })] as const)).then(
      (rows) => (last = Object.fromEntries(rows)),
    );
  });

  /** How much strength each position later usually costs, from this user's own history. */
  let cost = $state(0);
  void loadPositionCost().then((value) => (cost = value));
  const body = $derived(bodyKg(appSettings.bodyWeightKg));

  let openSetId = $state<string | null>(null);
  let opened = false;

  /** What the comment sheet is open for. */
  let noteTarget = $state<NoteTarget | null>(null);
  let noteOpen = $state(false);

  function openNote(detail: (typeof details)[number], set?: WorkoutSet) {
    if (!workout) return;
    const note = detail.notes.find((n) => (set ? n.setId === set.id : !detail.entry.sets.some((s) => s.id === n.setId)));
    noteTarget = { workoutId: id, exerciseId: detail.entry.exerciseId, date: workout.date, setId: set?.id, note };
    noteOpen = true;
  }

  /** The selected set, for the dock. */
  const selected = $derived.by(() => {
    for (const detail of details) {
      const set = detail.entry.sets.find((s) => s.id === openSetId);
      if (set) return { set, detail };
    }
    return null;
  });

  function dockProps(set: WorkoutSet, detail: (typeof details)[number]) {
    const performance = last[detail.entry.exerciseId];
    const work = detail.entry.sets.filter((s) => s.kind === 'work');
    return {
      title: detail.exercise ? nameOf(detail.exercise) : t('workout.unknownExercise'),
      number: work.indexOf(set) + 1,
      previous: pairSets(detail.entry.sets, performance?.sets ?? [])[detail.entry.sets.indexOf(set)],
      load: detail.exercise?.load ?? 'weight',
      levels: !!detail.exercise?.levels,
      step: stepFor(detail.exercise, detail.settings, performance?.sets.map((s) => s.weightKg) ?? []),
    };
  }

  /** The selected row stays in view above the dock. */
  $effect(() => {
    const setId = openSetId;
    if (!setId) return;
    void tick().then(() => {
      document
        .querySelector(`[data-set="${CSS.escape(setId)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
  });

  /** While logging, the next set to do is already open when the screen appears. */
  $effect(() => {
    if (opened || !data.value || !logging) return;
    opened = true;
    openSetId = untrack(() => nextOpenSet(entries)?.id ?? null);
  });

  let pickerOpen = $state(false);
  /** The exercise the picker is choosing a replacement for; none when it adds one. */
  let replacing = $state<(typeof details)[number] | null>(null);

  function openPicker(target: (typeof details)[number] | null) {
    replacing = target;
    pickerOpen = true;
  }
  let detailsOpen = $state(false);
  // Held here while typing: a save coming back from the database must not rewrite the field.
  let draftNote = $state('');

  $effect(() => {
    if (!detailsOpen) return;
    untrack(() => {
      draftNote = workout?.note ?? '';
    });
  });

  /** Bumped when a write fails: fields showing what didn't reach the database start over. */
  let failedSaves = $state(0);

  function saveFailed(error: unknown) {
    console.error(error);
    const message = t(isStorageFull(error) ? 'workout.storageFull' : 'workout.saveFailed');
    if (!ui.toasts.some((toast) => toast.message === message)) showToast(message, { timeout: 8000 });
    draftNote = workout?.note ?? '';
    failedSaves += 1;
  }

  /** Every write on this screen goes through here: `then` runs once it's stored, and a failure is shown. */
  function save<T>(write: Promise<T>, then?: (result: T) => void): Promise<void> {
    return write.then((result) => then?.(result), saveFailed);
  }

  function pickExercise(exerciseId: string) {
    const target = replacing;
    if (target) {
      const entry = target.entry.entry;
      return save(replaceExercise(id, entry, exerciseId), async (snapshot) => {
        undoToast(t('workout.exerciseReplaced'), snapshot);
        const sets = await db.sets.where('workoutId').equals(id).toArray();
        if (logging) openSetId = groupEntries(sets).find((e) => e.entry === entry)?.sets.find((s) => !s.done)?.id ?? null;
      });
    }
    return save(addExercise(id, exerciseId), async (entry) => {
      const sets = await db.sets.where('workoutId').equals(id).toArray();
      if (logging) openSetId = groupEntries(sets).find((e) => e.entry === entry)?.sets.find((s) => !s.done)?.id ?? null;
    });
  }

  function newSet(entry: Entry) {
    return save(addSet(id, entry.entry), (setId) => (openSetId = setId));
  }

  function toggleCheck(set: WorkoutSet) {
    const done = !set.done;
    return save(updateSet(set.id, { done }), () => {
      if (done) openSetId = nextOpenSet(entries, set.id)?.id ?? null;
    });
  }

  function dropSet(set: WorkoutSet, entry: Entry) {
    const message = entry.sets.length === 1 ? t('workout.exerciseRemoved') : t('workout.setRemoved');
    return save(removeSet(set.id), (snapshot) => undoToast(message, snapshot));
  }

  function editMachine(exerciseId: string, current: string | undefined) {
    void promptText({
      title: t('workout.machineSetting'),
      value: current ?? '',
      placeholder: t('workout.machinePlaceholder'),
      confirmLabel: t('common.save'),
    }).then((value) => {
      if (value !== null) void save(setMachineSetting(exerciseId, value));
    });
  }

  function exerciseMenu(detail: (typeof details)[number], index: number) {
    const { entry, exercise, settings } = detail;
    const items: ActionItem[] = [];
    if (index > 0) items.push({ label: t('workout.moveUp'), run: () => save(moveExercise(id, entry.entry, -1)) });
    if (index < details.length - 1) items.push({ label: t('workout.moveDown'), run: () => save(moveExercise(id, entry.entry, 1)) });
    if (settings?.machineSetting || (exercise && ['machine', 'cable', 'smith'].includes(exercise.equipment))) {
      items.push({ label: t('workout.machineSetting'), icon: 'edit', run: () => editMachine(entry.exerciseId, settings?.machineSetting) });
    }
    // Swapping is for what's still to do: logged work stays as it was.
    if (workout?.status !== 'done' && !entry.sets.some((s) => s.done)) {
      items.push({ label: t('workout.replaceExercise'), icon: 'refresh', run: () => openPicker(detail) });
    }
    if (exercise) {
      items.push({ label: t('workout.openExercise'), icon: 'chart', run: () => go(`/exercise/${encodeURIComponent(entry.exerciseId)}`) });
    }
    items.push({
      label: t('workout.removeExercise'),
      icon: 'trash',
      destructive: true,
      run: () => save(removeExercise(id, entry.entry), (snapshot) => undoToast(t('workout.exerciseRemoved'), snapshot)),
    });
    void chooseAction(exercise ? nameOf(exercise) : t('workout.unknownExercise'), items);
  }

  function nameBefore(index: number): string {
    const exercise = details[index - 1]?.exercise;
    return exercise ? nameOf(exercise) : t('workout.unknownExercise');
  }

  async function start() {
    const active = await activeWorkout();
    if (active && active.id !== id) {
      showToast(t('workout.finishOtherFirst'));
      go(`/workout/${active.id}`);
      return;
    }
    await save(startWorkout(id), () => {
      openSetId = nextOpenSet(entries)?.id ?? null;
    });
  }

  function leave() {
    replace('/');
  }

  function discard() {
    return save(deleteWorkout(id), (snapshot) => {
      undoToast(t('workout.discarded'), snapshot);
      leave();
    });
  }

  function finish(unchecked: 'done' | 'discard') {
    return save(finishWorkout(id, unchecked), (kept) => (kept ? replace(`/summary/${id}?finished=1`) : leave()));
  }

  async function askFinish() {
    const sets = entries.flatMap((e) => e.sets);
    if (!sets.length) {
      const ok = await confirmAction({
        title: t('workout.nothingLogged'),
        message: t('workout.nothingLoggedBody'),
        confirmLabel: t('workout.discard'),
        destructive: true,
      });
      if (ok) await discard();
      return;
    }
    const unchecked = sets.filter((s) => !s.done).length;
    if (!unchecked) return finish('done');
    void chooseAction(tn('workout.unchecked', unchecked), [
      { label: t('workout.markDone'), icon: 'check', run: () => finish('done') },
      { label: t('workout.discardUnchecked'), icon: 'trash', destructive: true, run: () => finish('discard') },
    ]);
  }

  function workoutMenu() {
    if (!workout) return;
    const items: ActionItem[] = [{ label: t('workout.details'), icon: 'edit', run: () => void (detailsOpen = true) }];
    if (workout.status === 'done') {
      items.push({ label: t('workout.summary'), icon: 'chart', run: () => go(`/summary/${id}`) });
      items.push({
        label: t('workout.repeat'),
        icon: 'refresh',
        run: async () => {
          const active = await activeWorkout();
          if (active) {
            showToast(t('workout.finishOtherFirst'));
            go(`/workout/${active.id}`);
          } else {
            await save(repeatWorkout(id), (copy) => go(`/workout/${copy}`));
          }
        },
      });
    }
    items.push({
      label: logging ? t('workout.discard') : t('workout.delete'),
      icon: 'trash',
      destructive: true,
      run: () => {
        if (logging) return discard();
        return save(deleteWorkout(id), (snapshot) => {
          undoToast(t('workout.deleted'), snapshot);
          replace(backTo);
        });
      },
    });
    void chooseAction(title, items);
  }
</script>

<div class="page">
  {#if data.value === undefined}
    <Header title={t('workout.untitled')} backTo="/" />
    <Skeleton lines={5} />
  {:else if workout}
    <Header {title} subtitle={fmtDate(workout.date)} {backTo}>
      {#snippet actions()}
        <button class="icon-btn" aria-label={t('workout.more')} onclick={workoutMenu}><Icon name="more" /></button>
      {/snippet}
    </Header>

    {#if workout.note}<p class="note muted">{workout.note}</p>{/if}

    <div class="exercises content-in">
      {#each details as detail, index (detail.entry.entry)}
        <div
          animate:flip={{ duration: dur(MOTION.base), easing: easeOut }}
          transition:fade={{ duration: dur(MOTION.fast), easing: easeOut }}
        >
          <ExerciseCard
            entry={detail.entry}
            exercise={detail.exercise}
            settings={detail.settings}
            last={last[detail.entry.exerciseId]}
            position={index + 1}
            previousName={index > 0 ? nameBefore(index) : null}
            {cost}
            {body}
            checkable={logging}
            {openSetId}
            onselect={(set) => (openSetId = openSetId === set.id ? null : set.id)}
            oncheck={toggleCheck}
            onaddset={() => newSet(detail.entry)}
            onmenu={() => exerciseMenu(detail, index)}
            onmachine={() => editMachine(detail.entry.exerciseId, detail.settings?.machineSetting)}
            onsuggest={workout.status === 'done' ? undefined : (suggestion) => save(applyPlan(workout.id, detail.entry.entry, suggestion.sets))}
            notes={detail.notes}
            offDay={isOffDay(detail.notes, appSettings.customTags)}
            onnote={(set) => openNote(detail, set)}
          />
        </div>
      {:else}
        <p class="empty">{t('workout.noExercises')}</p>
      {/each}
    </div>

    <div class="bar" class:sticky={workout.status !== 'done' && !selected}>
      <button class="btn add" aria-label={t('workout.addExercise')} onclick={() => openPicker(null)}>
        <Icon name="plus" size={24} />
      </button>
      {#if logging}
        <button class="btn btn-primary" onclick={askFinish}>{t('workout.finish')}</button>
      {:else if workout.status === 'planned'}
        <button class="btn btn-primary" onclick={start}>{t('workout.startPlanned')}</button>
      {/if}
    </div>

    {#key failedSaves}
      {#if selected}
        {@const { set, detail } = selected}
        <!-- Full height at once, so the selected row can scroll clear of the dock. It only shrinks going away. -->
        <div class="dock-space" class:tall={detail.exercise?.levels} out:collapse></div>
        <SetDock
          {set}
          {...dockProps(set, detail)}
          checkable={logging}
          onchange={(changes) => void save(updateSet(set.id, changes))}
          oncheck={() => toggleCheck(set)}
          onremove={() => dropSet(set, detail.entry)}
          oncomment={() => openNote(detail, set)}
          onclose={() => (openSetId = null)}
        />
      {/if}
    {/key}

    <ExercisePicker
      bind:open={pickerOpen}
      onpick={pickExercise}
      replacing={replacing?.exercise}
      inWorkout={entries.map((e) => e.exerciseId)}
    />
    {#if noteTarget}
      {#key noteTarget}
        <NoteSheet bind:open={noteOpen} target={noteTarget} />
      {/key}
    {/if}

    <Sheet bind:open={detailsOpen} title={t('workout.details')}>
      <div class="details">
        <div class="field">
          <label for="workout-date">{t('workout.date')}</label>
          {#key failedSaves}
            <input
              id="workout-date"
              class="input"
              type="date"
              value={workout.date}
              onchange={(e) => {
                if (e.currentTarget.value) void save(updateWorkout(id, { date: e.currentTarget.value }));
              }}
            />
          {/key}
        </div>
        <div class="field">
          <label for="workout-note">{t('workout.note')}</label>
          <textarea
            id="workout-note"
            class="input"
            placeholder={t('workout.notePlaceholder')}
            bind:value={draftNote}
            oninput={(e) => save(updateWorkout(id, { note: e.currentTarget.value }))}
          ></textarea>
        </div>
        {#if workout.rawText}
          <details>
            <summary class="muted">{t('workout.originalText')}</summary>
            <pre>{workout.rawText}</pre>
          </details>
        {/if}
      </div>
    </Sheet>
  {:else}
    <Header title={t('workout.untitled')} backTo="/" />
    <p class="empty">{t('workout.notFound')}</p>
  {/if}
</div>

<style>
  .note {
    margin: 0 4px 12px;
    white-space: pre-wrap;
  }
  .exercises {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* Room under the last row: the dock is fixed over the bottom of the screen. */
  .dock-space {
    height: 190px;
  }
  .dock-space.tall {
    height: 246px;
  }
  /* Stays within thumb reach however long the workout gets. With the dock open it ends the list instead, above the dock's space. */
  .bar.sticky {
    position: sticky;
    bottom: calc(var(--safe-bottom) + 10px);
    z-index: 5;
  }
  .bar {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }
  .bar .btn {
    flex: 1;
    min-height: 56px;
    box-shadow: var(--shadow-sm);
  }
  .bar .add {
    flex: 0 0 56px;
    padding: 0;
    background: var(--surface-3);
  }
  .details {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 12px;
  }
  .details .input {
    font-size: 16px;
  }
  pre {
    margin-top: 8px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: inherit;
    font-size: 14px;
    color: var(--text-2);
  }
</style>
