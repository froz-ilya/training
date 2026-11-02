<script lang="ts">
  import { route, isKnownRoute, isTabRoot } from './lib/router.svelte';
  import { online } from './lib/online.svelte';
  import { checkBackupReminder } from './lib/backupReminder';
  import { t } from './lib/i18n.svelte';
  import { onMount } from 'svelte';
  import Header from './components/Header.svelte';
  import TabBar from './components/TabBar.svelte';
  import DialogHost from './components/DialogHost.svelte';
  import ToastHost from './components/ToastHost.svelte';
  import Today from './routes/Today.svelte';
  import History from './routes/History.svelte';
  import Progress from './routes/Progress.svelte';
  import ProgressGroup from './routes/ProgressGroup.svelte';
  import Exercises from './routes/Exercises.svelte';
  import Settings from './routes/Settings.svelte';
  import Workout from './routes/Workout.svelte';
  import ExercisePage from './routes/ExercisePage.svelte';
  import Import from './routes/Import.svelte';
  import BodyWeight from './routes/BodyWeight.svelte';

  /*
   * Routes (hash based). Tab roots (show the bottom tab bar): /, /history, /progress, /exercises,
   * /settings.
   *   /                 Today: next workout, active workout
   *   /history          Past workouts
   *   /progress         Summary, muscle groups, what needs a look, records, calendar
   *   /exercises        Catalogue and own exercises
   *   /settings         Languages, theme, import, backup
   *   /workout/:id      Logger for an active workout, editor for a past one
   *   /group/:id        One muscle group: trend, weekly sets, its exercises by status
   *   /exercise/:id     One exercise: chart, records, sessions, settings
   *   /import           Import history from a JSON file
   *   /body             Body weight: log, chart, past weigh-ins
   * Any other path shows a not-found page with the tab bar, so a bad link is never a dead end.
   * Route components read route.parts / route.query themselves.
   */
  const ROUTES = {
    history: History,
    progress: Progress,
    exercises: Exercises,
    settings: Settings,
    workout: Workout,
    group: ProgressGroup,
    exercise: ExercisePage,
    import: Import,
    body: BodyWeight,
  } as const;

  // Backup reminder pop-up (waits for the first screen and any workout; once per launch).
  onMount(checkBackupReminder);

  const Page = $derived(ROUTES[route.parts[0] as keyof typeof ROUTES] ?? Today);
  const known = $derived(isKnownRoute(route.path));
  const showTabs = $derived(isTabRoot(route.path) || !known);
</script>

{#if !online.value}
  <div class="offline">{t('shell.offline')}</div>
{/if}

<div class="route-view">
  {#key route.path + '?' + route.query.toString()}
    {#if known}
      <Page />
    {:else}
      <div class="page">
        <Header title={t('workout.pageNotFound')} />
        <p class="empty">{t('workout.pageNotFoundHint')}</p>
      </div>
    {/if}
  {/key}
</div>

{#if showTabs}
  <TabBar />
{/if}

<ToastHost />
<DialogHost />

<style>
  .offline {
    position: sticky;
    top: 0;
    z-index: 26;
    padding: calc(var(--safe-top) + 4px) 16px 4px;
    background: var(--warn);
    color: var(--on-tone);
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    view-transition-name: offline-banner;
  }
  .route-view {
    min-height: 100vh;
    min-height: 100dvh;
  }
</style>
