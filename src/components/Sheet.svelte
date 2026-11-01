<script lang="ts" module>
  import { onDestroy, untrack, type Snippet } from 'svelte';

  /**
   * Modal behaviour for sheets and dialogs: while one is open, Tab stays inside it and everything
   * else is inert. A sheet sits deep inside the page, so "everything else" is the siblings of each of
   * its ancestors. The newest open panel is the one in charge, so a dialog can open over a sheet.
   */
  const FOCUSABLE =
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

  const panels: HTMLElement[] = [];
  let blocked: HTMLElement[] = [];

  function blockOutside(top: HTMLElement | undefined) {
    for (const el of blocked) el.inert = false;
    blocked = [];
    for (let node = top; node?.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        // Toasts stay live: "Undo" must still work while a sheet opens over it. The scrim stays live
        // so a tap on it closes the panel.
        if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert || sibling.matches('[aria-live], [data-scrim]')) continue;
        sibling.inert = true;
        blocked.push(sibling);
      }
    }
  }

  function holdFocus(panel: HTMLElement): () => void {
    panel.inert = false;
    panels.push(panel);
    blockOutside(panel);
    if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => {
      panels.splice(panels.indexOf(panel), 1);
      // It stays on screen while it animates out, but it's already gone for focus and taps.
      panel.inert = true;
      blockOutside(panels.at(-1));
    };
  }

  window.addEventListener(
    'keydown',
    (e) => {
      const panel = panels.at(-1);
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length && !el.closest('[inert]'));
      const active = document.activeElement;
      const wrapTo = !panel.contains(active) ? items[0] : e.shiftKey ? (active === items[0] || active === panel) && items.at(-1) : active === items.at(-1) && items[0];
      if (wrapTo || !items.length) {
        e.preventDefault();
        (wrapTo || panel).focus();
      }
    },
    true,
  );

  /** Safari doesn't focus a tapped button, so the last one tapped stands in for the focused element. */
  let pressed: HTMLElement | null = null;
  let pressedAt = 0;

  window.addEventListener(
    'click',
    (e) => {
      pressed = e.target instanceof Element ? e.target.closest<HTMLElement>('button, a, summary') : null;
      pressedAt = performance.now();
    },
    true,
  );

  function focusOrigin(): HTMLElement | null {
    if (pressed?.isConnected && !pressed.closest('[inert]') && performance.now() - pressedAt < 1000) return pressed;
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  }

  /**
   * Call while a component initialises, and put the returned attachment on its panel. On close, focus
   * goes back to what opened it. This watches `isOpen` rather than the panel because a closing panel
   * stays in the DOM until it has animated out, and a new one can open beside it in the meantime.
   */
  export function useModal(isOpen: () => boolean) {
    const open = $derived(isOpen());
    let panel = $state<HTMLElement | null>(null);
    let opener: HTMLElement | null = null;

    function giveFocusBack() {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      opener = null;
    }

    // Before the DOM updates, so the panel's own autofocus hasn't moved focus yet.
    $effect.pre(() => {
      if (open) untrack(() => (opener ??= focusOrigin()));
    });

    $effect(() => {
      if (open && panel) return holdFocus(panel);
    });

    // After the effect above, which has to lift `inert` from the opener first.
    $effect(() => {
      if (!open) giveFocusBack();
    });
    onDestroy(giveFocusBack);

    return (el: HTMLElement) => {
      panel = el;
      return () => {
        if (panel === el) panel = null;
      };
    };
  }
</script>

<script lang="ts">
  import { fade } from 'svelte/transition';
  import { dur, easeOut, MOTION, slideUp } from '../lib/motion';
  import { ui } from '../lib/ui/dialogs.svelte';
  import { t } from '../lib/i18n.svelte';
  import { openOverlay } from '../lib/ui/overlay';

  /**
   * Generic bottom sheet. Drag the handle/header down (or tap the backdrop, Esc, or system back)
   * to close.
   *
   *   <Sheet bind:open title="Filter">…</Sheet>
   */
  let {
    open = $bindable(false),
    title,
    tall = false,
    children,
    onclose,
  }: {
    open?: boolean;
    title?: string;
    /** Full height from the start, for a list that loads or filters while the sheet is open. */
    tall?: boolean;
    children: Snippet;
    onclose?: () => void;
  } = $props();

  /** Follows `open` a moment later: a sheet mounted already open would skip its slide otherwise. */
  let shown = $state(false);
  $effect(() => {
    shown = open;
  });

  // Closing is quicker than opening: nobody waits to read a sheet that's leaving.
  const duration = $derived(open ? MOTION.slow : MOTION.base);

  let dragY = $state(0);
  let dragging = $state(false);
  let height = $state(1);
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;

  function close() {
    if (!open) return;
    // dragY is kept so the sheet flies out from where the finger left it.
    open = false;
    onclose?.();
  }

  $effect.pre(() => {
    if (open) dragY = 0;
    else dragging = false;
  });

  // System back (Android) closes the sheet instead of leaving the page.
  $effect(() => {
    if (!open) return;
    const overlay = openOverlay(close);
    return () => overlay.release();
  });

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    dragging = true;
    height = (e.currentTarget as HTMLElement).parentElement?.offsetHeight || 1;
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    velocity = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!dragging) return;
    // Follows the finger down. It doesn't go up: that would open a gap under the sheet.
    dragY = Math.max(0, e.clientY - startY);
    const dt = e.timeStamp - lastT;
    if (dt > 0) velocity = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
  }

  function up(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    // A finger that stopped before lifting has no speed left, whatever its last move was.
    const flicked = velocity > 0.5 && e.timeStamp - lastT < 100;
    if (e.type === 'pointerup' && (dragY > 110 || (dragY > 24 && flicked))) close();
    else dragY = 0;
  }

  function onkeydown(e: KeyboardEvent) {
    // A dialog opened from inside the sheet handles Esc itself.
    if (open && e.key === 'Escape' && !ui.dialog && !e.defaultPrevented) {
      e.preventDefault();
      close();
    }
  }

  const modal = useModal(() => open);
</script>

<svelte:window {onkeydown} />

{#if shown}
  <div class="sheet-root">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="scrim"
      data-scrim
      role="presentation"
      style:opacity={dragY ? 1 - dragY / height : undefined}
      transition:fade={{ duration: dur(duration), easing: easeOut }}
      onclick={close}
    ></div>
    <div
      class="sheet-panel"
      class:dragging
      class:tall
      role="dialog"
      aria-modal="true"
      aria-label={title ?? t('shell.sheet')}
      tabindex="-1"
      {@attach modal}
      style:transform={dragY ? `translate3d(0, ${dragY}px, 0)` : undefined}
      transition:slideUp={{ duration }}
    >
      <div
        class="sheet-grip"
        role="presentation"
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
      >
        <span class="handle" aria-hidden="true"></span>
        {#if title}<h2 class="sheet-heading">{title}</h2>{/if}
      </div>
      <div class="sheet-content">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Lets taps through: only the scrim and the panel take them, and neither does while closing. */
  .sheet-root {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    pointer-events: none;
  }
  .sheet-panel {
    position: relative;
    pointer-events: auto;
    width: 100%;
    max-width: 640px;
    max-height: 85vh;
    max-height: 85dvh;
    display: flex;
    flex-direction: column;
    background: var(--surface-raised);
    max-height: calc(100dvh - var(--safe-top) - 24px);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: var(--shadow-lg);
    outline: none;
    transition: transform var(--dur) var(--ease);
  }
  .sheet-panel.tall {
    height: calc(100dvh - var(--safe-top) - 24px);
  }
  .sheet-panel.dragging {
    transition: none;
    will-change: transform;
  }
  .sheet-grip {
    flex-shrink: 0;
    padding: 8px 16px 4px;
    touch-action: none;
    cursor: grab;
    -webkit-user-select: none;
    user-select: none;
  }
  .handle {
    display: block;
    width: 38px;
    height: 5px;
    margin: 0 auto 8px;
    border-radius: 3px;
    background: var(--surface-3);
  }
  .sheet-heading {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    text-align: center;
    padding-bottom: 8px;
  }
  .sheet-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 4px 16px calc(var(--safe-bottom) + 16px);
  }
</style>
