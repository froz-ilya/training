import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://<user>.github.io/training/
const base = '/training/';

export default defineConfig({
  base,
  // Which build a phone is running, shown in Settings. GitHub Actions sets the variable.
  define: { __BUILD__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) || 'dev') },
  plugins: [
    svelte(),
    VitePWA({
      // Not autoUpdate: that reloads the page as soon as a new version lands, even mid-workout.
      // src/main.ts picks the moment.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Training',
        short_name: 'Training',
        description: 'Log gym workouts, follow your progress and plan the next session. Works offline.',
        lang: 'en',
        id: base,
        start_url: base,
        scope: base,
        display: 'standalone',
        display_override: ['standalone'],
        prefer_related_applications: false,
        orientation: 'portrait',
        background_color: '#0d1017',
        theme_color: '#0d1017',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,webmanifest,woff2}'],
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
