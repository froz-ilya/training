<script lang="ts">
  import { route, back, isKnownRoute, isTabRoot, parentOf } from './lib/router.svelte';
  import { online } from './lib/online.svelte';
  import { ui } from './lib/ui/dialogs.svelte';
  import { reducedMotion } from './lib/motion';
  import { checkBackupReminder } from './lib/backupReminder';
  import { t } from './lib/i18n.svelte';
  import { isIOS } from './lib/platform';
  import { hasOverlay } from './lib/ui/overlay';
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
  } as const;

  // Backup reminder pop-up (waits for the first screen and any workout; once per launch).
  onMount(checkBackupReminder);

  const Page = $derived(ROUTES[route.parts[0] as keyof typeof ROUTES] ?? Today);
  const known = $derived(isKnownRoute(route.path));
  const showTabs = $derived(isTabRoot(route.path) || !known);

  /*
   * Edge-swipe back (standalone iOS PWAs have no system back gesture): a touch that starts
   * within EDGE px of the left edge on a non-tab-root page and travels right > TRIGGER px,
   * mostly horizontally, goes back. The page follows the finger at half speed and a back
   * arrow fades in. Elements can opt out with a `data-no-edge-swipe` ancestor.
   * iOS only: Android has its own system back gesture, which ours would fight with.
   */
  const EDGE = 24;
  const TRIGGER = 80;
  let swipe = $state({ active: false, path: '', dx: 0, y: 0 });
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const swipeProgress = $derived(Math.min(1, swipe.dx / TRIGGER));
  // Only applies while we're still on the page the gesture started on, so the new page
  // (rendered inside the view-transition update) never inherits the offset.
  const pageShift = $derived(
    swipe.active && swipe.path === route.path && !reducedMotion() ? Math.min(swipe.dx * 0.5, 160) : 0,
  );

  function reset() {
    tracking = false;
    swipe = { active: false, path: '', dx: 0, y: 0 };
  }

  $effect(() => {
    if (swipe.path && route.path !== swipe.path) reset();
  });

  $effect(() => {
    if (!isIOS()) return;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || isTabRoot(route.path) || ui.dialog || hasOverlay()) return;
      const touch = e.touches[0];
      if (touch.clientX > EDGE) return;
      const target = e.target as Element | null;
      if (target?.closest?.('[role="dialog"], [data-no-edge-swipe], input, textarea, select')) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
      swipe = { active: false, path: route.path, dx: 0, y: touch.clientY };
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!swipe.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return reset();
        if (dx < -4) return reset();
        if (dx > 10 && dx > Math.abs(dy) * 1.2) swipe.active = true;
        else return;
      }
      if (e.cancelable) e.preventDefault();
      swipe.dx = Math.max(0, dx);
      swipe.y = touch.clientY;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      if (swipe.active && swipe.dx > TRIGGER && e.type === 'touchend') {
        // Keep the offset until the route changes (the transition captures the shifted old
        // page and slides it the rest of the way); the effect below clears it.
        tracking = false;
        back(parentOf(route.path));
        setTimeout(() => !tracking && reset(), 1000);
      } else reset();
    };
    const opts = { passive: false } as const;
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, opts);
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  });
</script>

{#if !online.value}
  <div class="offline">{t('shell.offline')}</div>
{/if}

<div
  class="route-view"
  class:swiping={pageShift > 0}
  style:transform={pageShift > 0 ? `translate3d(${pageShift}px, 0, 0)` : undefined}
>
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

{#if swipe.active && swipe.path === route.path}
  <div
    class="edge-back"
    class:armed={swipeProgress >= 1}
    style:top="{swipe.y - 20}px"
    style:opacity={swipeProgress}
    style:transform="translateX({Math.min(swipe.dx * 0.25, 24) - 8}px) scale({0.6 + 0.4 * swipeProgress})"
    aria-hidden="true"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
  </div>
{/if}

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
  .route-view.swiping {
    background: var(--bg);
    box-shadow: var(--shadow-edge);
    will-change: transform;
  }
  .edge-back {
    position: fixed;
    left: 8px;
    z-index: 40;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    color: var(--muted);
    box-shadow: var(--shadow-lg);
    pointer-events: none;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
  }
  .edge-back.armed {
    background: var(--accent-fill);
    color: var(--accent-text);
  }
</style>
