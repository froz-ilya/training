# Build plan

Offline workout PWA with no backend. It uses the same stack and look as language-learning: Svelte 5,
TypeScript, Vite, Dexie and vite-plugin-pwa. The rules in [CLAUDE.md](../CLAUDE.md) apply to every
phase.

## Screens

| Tab | Purpose |
|---|---|
| Today | Next suggested workout, active workout, start an empty workout |
| History | Past workouts by date; open, edit or delete |
| Progress | Muscle groups, recent bests, training calendar |
| Exercises | Catalogue and own exercises, searchable in all three languages |
| Settings | Languages, theme, import, backup and restore |

Sub-pages: workout logger (`/workout/:id`), exercise detail (`/exercise/:id`), import (`/import`) and
body weight (`/body`).

## Data model

Everything is stored in IndexedDB on the device. The catalogue ships with the app.

| Store | Holds |
|---|---|
| `workouts` | Date, status (planned, active, done), source, note, original imported text. Titles are worked out from the exercises |
| `sets` | Workout, exercise, position, kind (warm-up, work), weight, reps or seconds, failure, level, done |
| `customExercises` | Exercises a user adds, with names in up to three languages |
| `aliases` | Names from imported logs, mapped to exercise ids |
| `exerciseSettings` | Machine setting, weight step, rep range, goal |
| `baselines` | Machine or gym changes, where comparisons restart |
| `stallRecords` | What a user tried for a plateau, and whether it worked |
| `exerciseNotes` | Comments and tags on an exercise or set in a workout |
| `bodyWeights` | Weigh-ins, one a day |
| `settings` | App settings |

## Phases

### 1. Foundation

- App shell, design tokens and shared components from language-learning
- Interface in English, German and Russian
- Versioned database, pre-upgrade safety copy and the "update needed" screen
- Exercise catalogue with stable ids and names in three languages
- On-device import from one JSON file (see import-format.md)

### 2. Logging

- Build a workout and log sets with large controls, prefilled from last time
- Progress saved after every change, so closing the app loses nothing
- Exercise picker with search in all three languages
- History: view, edit and delete workouts, with undo

### 3. Progress

- Weight and estimated strength chart per exercise
- Personal records and recent sessions
- Training calendar and weekly volume

### 4. Suggestions and plateaus

- Weight for today, with the reason shown
- Warm-up sets filled in from the user's own pattern
- Next workout from the user's rotation
- Exercise status: progressing, holding, stalled, dropping, returning
- Plateau options, and a record of which ones helped
- Machine or gym changes restart the comparison

### 5. Finish

- Backup through the share sheet, restore, and backup reminders
- Install flow, offline check and app icons
- Migration tests, phone-width checks in three languages, final build

## Definition of done

Each phase ends with `npm run check` at 0 errors and warnings, `npm test` passing, a production
build, and a check of the new screens in a browser.

## Not in scope

Accounts, sync, nutrition, a user's own photos, keep-screen-on, spoken rest timer.
