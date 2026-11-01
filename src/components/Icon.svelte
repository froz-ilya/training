<script lang="ts" module>
  // Simple stroke icons (24×24 viewBox).
  const PATHS = {
    back: 'M15 5l-7 7 7 7',
    chevron: 'M9 5l7 7-7 7',
    comment: 'M4 5h16v11H9l-5 4z',
    plus: 'M12 5v14M5 12h14',
    gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
    trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
    edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
    play: 'M7 4l13 8-13 8z',
    check: 'M5 12l5 5 9-10',
    x: 'M6 6l12 12M18 6L6 18',
    import: 'M12 3v12M7 10l5 5 5-5M4 19h16',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
    flame: 'M12 22c4 0 7-2.7 7-6.6 0-3.3-2.2-5.6-3.6-7.1-.3 1.8-1.2 3-2.4 3.4.3-3.3-1-6.4-4-8.7.2 3-1.4 5.1-2.9 6.9C4.9 11.4 5 13.3 5 15.4 5 19.3 8 22 12 22z',
    dumbbell: 'M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    chart: 'M4 20V4M4 20h16M8 15l3-4 3 2 5-6',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    trophy: 'M8 4h8v6a4 4 0 01-8 0zM8 6H4v2a4 4 0 004 4M16 6h4v2a4 4 0 01-4 4M12 14v4M8 20h8',
    minus: 'M5 12h14',
    share: 'M12 15V3M8 7l4-4 4 4M5 12v8h14v-8',
    swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
    sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 22, filled = false }: { name: IconName; size?: number; filled?: boolean } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>
