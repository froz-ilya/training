import { mount, unmount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import './styles/app.css';
import App from './App.svelte';
import UpdateNeeded from './routes/UpdateNeeded.svelte';
import { quietForUpdate } from './lib/backupReminder';
import { loadSettings, normalizeSettings, settings } from './lib/settings.svelte';
import { initTheme } from './lib/theme.svelte';
import { initLanguage } from './lib/language.svelte';
import { db, requestPersistence } from './lib/db/schema';
import { preflight, readInstalledSettings } from './lib/db/safety';
import './lib/install.svelte'; // listen for beforeinstallprompt from the start

const target = document.getElementById('app')!;

// iOS Safari only applies :active, which all press feedback uses, on a page that listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true });

/**
 * Updates. A new version installs in the background and then waits (registerType 'prompt'), because
 * reloading under the user could lose a comment being typed. It takes over:
 * - at launch, before anything is on screen: everything is saved by then, even an active workout,
 *   so an app that's always mid-workout can't stay on an old version for ever;
 * - when the app comes back to the screen at a quiet moment (see isQuietMoment): a phone can keep
 *   an installed app suspended for weeks without ever launching it again;
 * - straight away on the update screen, which has nothing to lose.
 * Until then the installed version keeps running, offline too. Taking over in one tab reloads the
 * others only when they're quiet as well.
 */
type Screen = 'starting' | 'app' | 'stopped';
let screen: Screen = 'starting';
/** A new version is ready to take over, or has already, from another tab. */
let waiting = false;
let activated = false;
let registration: ServiceWorkerRegistration | undefined;

const activateUpdate = registerSW({
  immediate: true,
  onRegisteredSW: (_url, r) => (registration = r),
  onNeedRefresh() {
    waiting = true;
    if (screen === 'stopped') void updateWhenQuiet();
  },
  onNeedReload() {
    activated = true;
    void updateWhenQuiet();
  },
});

async function updateWhenQuiet() {
  if (!waiting && !activated) return;
  if (screen === 'starting' || (screen === 'app' && !(await quietForUpdate()))) return;
  if (activated) location.reload();
  else void activateUpdate();
}

const CHECK_EVERY = 60 * 60 * 1000;
let lastCheck = Date.now();

/** The browser only looks for a new version on a launch, and a suspended app doesn't launch. */
function checkForUpdate(): Promise<unknown> {
  if (!registration || !navigator.onLine) return Promise.resolve();
  lastCheck = Date.now();
  return registration.update().catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastCheck > CHECK_EVERY) void checkForUpdate();
  void updateWhenQuiet();
});

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Lets a version that's already waiting take over at launch. True when the page is reloading. */
async function takeWaitingVersion(): Promise<boolean> {
  const workers = navigator.serviceWorker;
  if (!workers) return false;
  const found = await Promise.race([workers.getRegistration().catch(() => undefined), wait(1000)]);
  if (!found?.waiting || !workers.controller) return false;
  const changed = new Promise<boolean>((resolve) => {
    workers.addEventListener('controllerchange', () => resolve(true), { once: true });
    void wait(4000).then(() => resolve(false));
  });
  found.waiting.postMessage({ type: 'SKIP_WAITING' });
  if (!(await changed)) return false; // Stuck: the installed version still works, so carry on.
  location.reload();
  return true;
}

/** The update screen's button: look for the new version, then reload, which installs it. */
async function reloadForUpdate() {
  await Promise.race([checkForUpdate(), wait(3000)]);
  location.reload();
}

let themed = false;

function applyLook() {
  if (themed) return;
  themed = true;
  initTheme();
  initLanguage();
}

/** Language and theme for a screen that shows while the data can't be opened. Only reads. */
async function applySavedLook() {
  if (!themed) Object.assign(settings, normalizeSettings(await readInstalledSettings()));
  applyLook();
}

let app: ReturnType<typeof mount> | undefined;

/** The data is newer than this code: at launch, or because another tab has just upgraded it. */
async function stopForUpdate() {
  if (screen === 'stopped') return;
  screen = 'stopped';
  if (app) void unmount(app);
  app = undefined;
  await applySavedLook();
  mount(UpdateNeeded, { target, props: { onreload: reloadForUpdate } });
  void updateWhenQuiet();
}

/** Storage stopped the upgrade (see safety.ts): nothing has changed, and the user decides. */
async function showStorageProblem() {
  await applySavedLook();
  const problem = mount(UpdateNeeded, {
    target,
    props: {
      onreload: () => location.reload(),
      onskip: () => {
        void unmount(problem);
        void startApp();
      },
    },
  });
}

async function startApp() {
  void requestPersistence();
  try {
    await loadSettings();
  } catch (e) {
    if (db.outdated) return;
    console.error('the data could not be opened', e);
    await showStorageProblem();
    return;
  }
  if (db.outdated) return;
  applyLook();
  app = mount(App, { target });
  screen = 'app';
}

async function start() {
  if (await takeWaitingVersion()) return;
  // Stays on while the app runs: an old tab must stop as soon as a newer one upgrades the data.
  db.whenOutdated(() => void stopForUpdate());
  // An old cached app must not open data saved by a newer one.
  const state = await preflight();
  if (state === 'update-needed') await stopForUpdate();
  else if (state === 'copy-failed') await showStorageProblem();
  else await startApp();
}

void start();
