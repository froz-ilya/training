<script lang="ts">
  import { route, switchTab } from '../lib/router.svelte';
  import { reducedMotion } from '../lib/motion';
  import { t } from '../lib/i18n.svelte';

  /** iOS-style bottom tab bar, shown on the five tab roots (App.svelte decides). */
  const TABS = [
    { path: '/', label: 'shell.tab.today', icon: 'M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12' },
    { path: '/history', label: 'shell.tab.history', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' },
    { path: '/progress', label: 'shell.tab.progress', icon: 'M4 20V4M4 20h16M8 15l3-4 3 2 5-6' },
    { path: '/exercises', label: 'shell.tab.exercises', icon: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' },
    {
      path: '/settings',
      label: 'shell.tab.settings',
      icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
    },
  ] as const;

  /** Where the indicator sits: over the active tab, whose width depends on its label. */
  let bar = $state<HTMLElement>();
  let indicator = $state<{ x: number; y: number } | null>(null);

  function place() {
    const tab = bar?.querySelector<HTMLElement>('.tab.active');
    const pill = tab?.querySelector<HTMLElement>('.pill');
    // Measured in two steps because a tab is positioned, so the press animation can't change the result.
    indicator = tab && pill ? { x: tab.offsetLeft + pill.offsetLeft, y: tab.offsetTop + pill.offsetTop } : null;
  }

  $effect(() => {
    void route.path;
    place();
  });

  // Tabs change width with the language and when the web font arrives.
  $effect(() => {
    if (!bar) return;
    const observer = new ResizeObserver(place);
    for (const tab of bar.querySelectorAll('.tab')) observer.observe(tab);
    return () => observer.disconnect();
  });

  function select(path: string) {
    if (route.path === path) {
      // Tapping the active tab scrolls back to the top, like iOS.
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    switchTab(path);
  }
</script>

<nav class="app-tabbar" aria-label={t('shell.tab.nav')} bind:this={bar}>
  {#if indicator}
    <span class="indicator" aria-hidden="true" style:transform="translate3d({indicator.x}px, {indicator.y}px, 0)"></span>
  {/if}
  {#each TABS as tab (tab.path)}
    {@const active = route.path === tab.path}
    <a
      href="#{tab.path}"
      class="tab"
      class:active
      aria-current={active ? 'page' : undefined}
      onclick={(e) => {
        e.preventDefault();
        select(tab.path);
      }}
    >
      <span class="pill"><svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width={active ? 2.2 : 1.8}
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d={tab.icon} />
      </svg></span>
      <span>{t(tab.label)}</span>
    </a>
  {/each}
</nav>

<style>
  .app-tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    display: flex;
    justify-content: center;
    padding: 6px max(8px, env(safe-area-inset-left, 0px)) calc(var(--safe-bottom) + 2px)
      max(8px, env(safe-area-inset-right, 0px));
    min-height: var(--tabbar-h);
    background: var(--chrome-bg);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
    box-shadow: inset 0 1px 0 var(--hairline);
  }
  /* Sized by their labels, so the short ones leave room for the long ones on a narrow phone. */
  .tab {
    position: relative;
    flex: 1 1 auto;
    max-width: 160px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 48px;
    color: var(--muted);
    text-decoration: none;
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.02em;
    white-space: nowrap;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    transition:
      color var(--dur-fast) var(--ease),
      transform var(--dur-fast) var(--ease);
  }
  @media (max-width: 359px) {
    .tab {
      font-size: 10px;
      letter-spacing: 0;
    }
  }
  .tab:active {
    transform: scale(0.92);
    transition-duration: var(--dur-press);
  }
  .pill {
    display: grid;
    place-items: center;
    width: 54px;
    height: 30px;
  }
  .indicator {
    position: absolute;
    top: 0;
    left: 0;
    width: 54px;
    height: 30px;
    border-radius: 999px;
    background: var(--accent-soft);
    transition: transform var(--dur) var(--ease);
  }
  .tab.active {
    color: var(--accent);
  }
  .tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -4px;
    border-radius: var(--radius-sm);
  }
  @media (prefers-reduced-motion: reduce) {
    .tab {
      transition: none;
    }
    .tab:active {
      transform: none;
    }
  }
</style>
