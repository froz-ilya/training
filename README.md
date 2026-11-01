# Training

A workout tracker for the gym that works offline. Log your sets, see your progress, get a suggested
weight for today and a draft of your next workout. Exercise names and the interface are available
in English, German and Russian.

## Privacy

There is no account and no server. Your workouts stay in your browser's storage on your device, and
the app sends them nowhere. That also means your device holds the only copy, so make a backup from
Settings now and then. A backup is one file you can keep in Files or iCloud Drive.

This repository contains only the app and a general exercise catalogue. It never contains anyone's
workouts or chat exports.

## Install on iPhone

1. Open the app's page in Safari.
2. Tap Share.
3. Tap Add to Home Screen.

After that it opens like a normal app and works without a connection.

## Import your history

Settings → Import history adds workouts from a JSON file, on your device; the format is in
[docs/import-format.md](docs/import-format.md). Nothing is uploaded.

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

Other commands: `npm test`, `npm run check`, `npm run build`.

## License

Apache-2.0. The Nunito font is under the SIL Open Font License (public/fonts/OFL-Nunito.txt).
