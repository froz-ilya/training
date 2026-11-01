# Import file format

Settings → Import history reads one JSON file: workouts, each with its exercises, each with its
sets. Import adds to what's in the app: a day that already has a workout stays as it is, so
importing the same file twice adds nothing, and the app says which days it left out and why. A
backup file works here too.

The whole file is checked first. If something in it can't be used, nothing is added and the app says
where the problem is, so it can be fixed in the file. Nothing is guessed or quietly dropped.

Imported sets join the ones logged in the app, because exercises are stored by id and not by name.
So a file in Russian and workouts logged in English build on the same exercise history.

```json
{
  "app": "training",
  "format": "history",
  "version": 1,
  "exerciseSettings": [
    {
      "exerciseId": "machine-chest-press",
      "name": "Machine chest press",
      "machineSetting": "Seat 8"
    }
  ],
  "gymChanges": [{ "date": "2025-09-01", "note": "New gym" }],
  "workouts": [
    {
      "date": "2026-05-14",
      "text": "14.05.2026 Legs ...",
      "exercises": [
        {
          "exerciseId": "leg-press-narrow",
          "name": "Leg press, narrow stance",
          "machineSetting": "seat 8",
          "comments": [{ "tags": ["badSpotter"], "text": "Spotter took the bar early" }],
          "sets": [
            { "kind": "warmup", "weightKg": 75, "reps": 13 },
            { "kind": "work", "weightKg": 125, "reps": 9 },
            { "kind": "work", "weightKg": 125, "reps": 7, "failure": true }
          ]
        },
        {
          "exerciseId": "inverted-row",
          "sets": [{ "kind": "work", "reps": 9, "level": 6, "failure": true }]
        },
        {
          "exerciseId": "plank",
          "sets": [{ "kind": "work", "seconds": 72 }]
        }
      ]
    }
  ]
}
```

- `app` is always `training`, and `format` is always `history`. A file from a newer `version` than
  the app is refused.
- `date` is a local `YYYY-MM-DD` date, and it has to exist: `2026-02-30` is refused, here and in
  `gymChanges`. `note` and `text` (the workout as first written down) are optional text.
- A workout has no title. The app names it after its muscle groups (chest, back, legs, shoulders,
  arms, core, cardio, full body) in the language it's showing, so `title` is ignored.
- An exercise needs `name` or `exerciseId`, both text. `exerciseId` is an id from
  src/lib/catalog/exercises.ts, from the custom exercises on the device, or from the file's optional
  `customExercises` list. A custom exercise in that list with the same name as one on the device
  uses the device's, whether the file refers to it by id or by name.
- Each entry in `customExercises` needs an `id` and `names` with `en`, `de` and `ru`, at least one of
  them filled in. `muscle`, `equipment` and `load` are optional and default to full body, other and
  weight.
- `name` can be any name of a catalogue exercise or of a custom exercise on the device, in English,
  German or Russian. A name the app doesn't know becomes one new exercise, under Full body until its
  muscle is changed. All the sets under that name in the file decide how it's measured: time if any
  has `seconds`, weight if any has `weightKg`, otherwise bodyweight.
- Exercises and sets are in the order they were done, so an exercise's place in the workout counts.
- `kind` is `warmup` or `work`, and `work` is the default. `reps` can have a decimal for a partial
  rep, and `weightKg` a decimal too. A timed exercise has `seconds`. For a bodyweight exercise,
  `weightKg` is the added weight. `weightKg`, `reps` and `seconds` are numbers, 0 or more.
- `failure` is `true` on a set taken to the point where another rep wasn't possible.
- `level` is the bar or platform height, as numbered in the gym, for exercises such as inverted rows.
  It's a whole number from 1 up. Reps are only compared at the same level.
- `gymChanges` is optional and lists moves to another gym, each with a `date` and an optional `note`.
  Machine, cable and Smith exercises trained before that date, in the file or in the app, restart
  their comparison from it. Barbell and dumbbell exercises don't, because their weights mean the same in any gym. Your history
  stays, and importing the same change twice adds nothing.
- `exerciseSettings` is optional and holds what's set up for an exercise, found by `exerciseId` or
  `name` the same way as in a workout. `machineSetting` is free text, such as a seat position, and
  shows on the exercise's card. `stepKg`, `repLow`, `repHigh` and `goal` (`progress` or `maintain`)
  can be set here too. A setting already in the app stays as it is, and one for a name that neither
  the app nor a workout in the file knows is skipped.
- A custom exercise is only added along with a workout that uses it.
- `comments` are optional, and each one has `tags`, `text` or both. `tags` are ids: `badSpotter`,
  `tired`, `poorSleep`, `sick`, `pain`, `shortOnTime`, `busyGym`, or a custom tag's id. A comment can
  also be plain text, and `tags` a single id, so `"comments": ["Felt good"]` and
  `"comments": [{ "tags": "pain" }]` both work.
- A workout isn't added while the app has one in progress on that day, or, for a backup holding its
  own unfinished workout, while any workout is in progress. Finish it and import again.
