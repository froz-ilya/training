# Training — notes for Claude

Workout tracking PWA for anyone to use at the gym. It runs offline with no backend, and all user
data stays on the user's device. Interface and exercise names are in Russian, English and German.

Svelte 5 (runes) + TypeScript + Vite + Dexie (IndexedDB) + vite-plugin-pwa. Deployed to GitHub Pages
from `main` (base path `/training/`). The build plan is in docs/plan.md.

## Commands

```bash
npm run dev      # dev server
npm test         # vitest (includes database migration tests)
npm run check    # svelte-check, must stay at 0 errors / 0 warnings
npm run build    # production build
npm run icons    # redraw public/icons from scripts/icons.mjs
```

## Personal data never enters the repo (hard rule)

This repository is public-facing. It holds only the app and general content that lets anyone use
it for their own workouts, such as the exercise catalogue.

- A user's history lives only on their device. That covers workouts, weights, notes, chat exports,
  messages from a trainer and receipts. None of it goes into the repo, the built app, test
  fixtures, commit messages, issues, pull requests or workflows.
- History comes into the app on the device, from a private file the user selects. It's never
  bundled with the app or fetched from the deployed site.
- Scripts that convert exports write their output outside the repo, or to a gitignored path.
- Tests and examples use invented data, never data copied from a real user.
- Defaults and thresholds suit any user. Never tune them to one person's exercises or numbers.

## User data must stay compatible (hard rule)

There's no backend, so the device holds the only copy of the data. Every update must open data
saved by any earlier version without losing anything. If a change can't be compatible, it needs a
migration that is tested.

- **IndexedDB:** never edit or remove an existing schema version. Add a new version with an upgrade
  step that fills defaults or converts data. Only add tables and indexes; never rename or drop a
  table or a field that holds user data.
- **New fields** on stored records get a default in the upgrade step, or are optional and read with
  a fallback.
- **Raw facts only:** store what happened (date, exercise, weight, reps, set type). Strength
  estimates, statuses and suggestions are calculated when needed, so changing how they work never
  needs a migration.
- **Exercise ids never change.** Names and translations live apart from the id, so they can change
  freely. Merging two exercises keeps the old id working as an alias.
- **Settings:** new fields get a default; saved values are merged over the defaults. Never change
  the meaning of an existing value.
- **localStorage:** read every key inside try/catch and validate it; unknown or missing values fall
  back to a default.
- **Imported history** keeps its original text on the device, so it can be read again by a better
  importer, and importing the same data twice creates no duplicates.
- **Backups:** the backup file carries a version number, and import must accept every older
  version.
- **Upgrades:** save a safety copy on the device before a schema upgrade. An old cached app that
  finds newer data asks the user to update and doesn't touch the data.
- **Tests:** every schema or stored-format change adds a migration test that creates the old
  database exactly as that version stored it and checks that it opens correctly. Old schema
  snapshots are never edited.

## Scope

- Suggestions and plateau detection use on-device rules. They stay editable, explain their reason
  and never promise a result.
- Not wanted: a keep-screen-on feature or a spoken rest timer.

## Conventions

- UI: shared tokens and classes in src/styles/app.css (light and dark themes via `html[data-theme]`).
  Motion goes through `dur()` (src/lib/motion.ts) so Reduce Motion is respected.
- No native `prompt/confirm/alert`: use src/lib/ui/dialogs.svelte.ts.
- Version 1 of the schema isn't released yet, so it can still change. From the first deploy, the
  rules above apply to it in full.
- Database: schema in src/lib/db/schema.ts. Raising `SCHEMA_VERSION` also means a new
  `this.version()` block, a step in `normalizeTables()` (src/lib/db/safety.ts) when a field or format
  changes, and a case in src/lib/db/migration.test.ts. A new table goes in `USER_TABLES`.
- Backup files carry the schema version of their data, so old backups and old safety copies restore
  through the same `normalizeTables()`.
- Exercises: src/lib/catalog/exercises.ts holds the catalogue. A user's own exercises get a
  `custom-` id. Names always go through `nameOf()` (src/lib/exercises.svelte.ts), never a stored name.
  A new catalogue exercise also needs its body regions in src/lib/catalog/regions.ts and its level in
  src/lib/catalog/difficulty.ts.
- Exercise photos: src/lib/catalog/photos.ts credits each picture in public/photos, and the exercise
  page shows the credit. Pictures ship with the app, so nothing loads from another site. Use only
  files with a free licence on Wikimedia Commons, checked on the file's own page, and look at the
  picture: Commons titles can be wrong. No recognisable people. Never use a manufacturer's images:
  Technogym's terms forbid copying them without written permission. A machine with no fitting
  picture has none, which is better than showing the wrong machine.
- The body map on Progress shows training, never muscle size: work sets a week per region against a
  general range (src/lib/coach/balance.ts). Goals per region are in `settings.regionGoals`. A goal also
  steers the next workout (src/lib/coach/focus.ts): Focus adds one exercise per region while it's short
  for the week, at most two a workout, and only if the workout stays within a point of its usual
  difficulty. A pick swaps a filler that trains its other main muscle; otherwise the first goes on top
  if that fits, and any other swaps a filler. Medium and hard picks go straight after the main lifts,
  light ones last.
  Maintain drops fillers once its range is met. Main lifts and weights don't change.
- Dates are local `YYYY-MM-DD` strings (src/lib/dates.ts).
- Workout titles are derived from the muscle groups trained (src/lib/workout/title.ts) and never
  stored, so they follow the interface language.
- Sets: a new set starts with last time's `failure` mark, so someone who always trains to failure only
  taps the exception, and only done sets count. `level` is copied too, and reps are never compared
  across levels, because whether higher is easier depends on the exercise.
- Breaks: the cut grows with time away (src/lib/coach/suggest.ts, `BREAKS`). When other exercises kept the
  muscle trained, half the cut goes, but the muscle's own rest still counts in full. After a break the
  weight climbs a step a session back to the old numbers, then normal progression takes over.
- Body weight: `bodyWeights` holds one weigh-in a day (src/lib/bodyWeight.ts). An exercise's chart and
  records read each session at that day's weight. Status, suggestions, new bests and the logger's marks
  hold every session at the latest weight, kept in `settings.bodyWeightKg`, so a swing on the scales
  never reads as a change in strength.
- Workout summary (`/summary/:id`, src/lib/coach/data.ts): shown after finishing and from a past
  workout's menu. Nothing in it is stored. Each exercise card is one row. Changes come from
  `compareExercise()` and new bests from `newBests()`, the same rules as the logger's marks and
  Progress. No change is shown across a machine or gym change. A time over 5 hours means the workout
  was left open, so it isn't shown.
- Comments: `exerciseNotes` holds them, per exercise in a workout or per set through `setId`. Built-in
  tag ids are in src/lib/notes/tags.ts and never change; a user's own tags are in
  `settings.customTags`. A session with an off-day tag doesn't count against an exercise, but a new
  best in it still counts, and `pain` blocks an increase at the next session.
- Avoided exercises: `avoid` in `exerciseSettings` means the coach never suggests the exercise, while the
  user can still add it by hand. History, the rotation and Progress keep reading it. A plan swaps it for a
  stand-in (src/lib/coach/standIn.ts) that trains the same main region, what the user has done first, or
  drops it if nothing fits. Anything new that suggests an exercise has to leave avoided ones out.
- Sometimes: `sometimes` in `exerciseSettings` is for a hard exercise the user wants to do now and then
  (src/lib/coach/sometimes.ts). `avoid` wins if a row has both. It goes by the date last done, not the
  rotation's window, so skipping it never makes it drop out. From 21 days after it was last done, or if
  it never was, it's due: one a workout, on a day its muscle can join. It takes a same-muscle filler's
  place, or waits if that muscle has had its week, or goes on top, or takes another filler's place, with no
  limit on difficulty. Until then it rests: out of the plan, the pool and Focus, unless it leads its variant.

## Interface language

The interface is in English, German and Russian (`settings.uiLang`: auto, en, de, ru; auto follows
the phone). Exercise names have their own setting (`settings.exerciseLang`).

- Text the user can see never goes in code: it's a key in src/lib/i18n/messages/<area>.ts, with all
  three languages side by side. Each file's English object ends in `as const`, or placeholders aren't
  type-checked. `npm run check` fails on a missing or unknown key, and src/lib/i18n.test.ts on
  different placeholders.
- `t('key', { name })` in .svelte and .ts; `tn('common.sets', n)` for counts; `tParts` when a sentence
  has markup in it. Never build a sentence from pieces: word order differs. Russian plurals need
  `.one`, `.few`, `.many` and `.other`.
- Numbers and dates go through `fmtNumber()`, `fmtDate()` and `locale()`.
- German uses informal "du". Russian uses formal "вы". German and Russian run longer than English:
  check narrow rows and buttons at phone width.

## Local environment quirks

- npm's default cache isn't writable here: use `npm_config_cache=<scratchpad>/npm-cache npm …`.
- The desktop app's preview launcher can't start servers in ~/Documents: run
  `npx vite --port 5173 --strictPort --host 127.0.0.1` from Bash in the background and attach with
  the `dev-attach` config in .claude/launch.json.
