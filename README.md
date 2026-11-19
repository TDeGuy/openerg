# OpenErg

A free companion app for the Concept2 PM5 (RowErg, SkiErg, BikeErg) for Android and iOS.
No accounts, no paywalls; all data stays on the phone.

## Download

Android: grab the latest `.apk` from the [Releases page](https://github.com/TDeGuy/openerg/releases) and open it on your phone
(allow installing from your browser when Android asks). Installing a newer version over the top keeps your workouts.
The version is shown in Settings → About.

## What it does

- Connects to the PM5 over Bluetooth and shows every metric the monitor reports.
- Live rowing screen (landscape): your own pages of stat tiles and graphs, live force curve
  with ideal / previous / average overlays, pace boat, splits.
- Built-in coxswain: spoken pacing, technique, interval and race-plan calls — see
  [docs/COXSWAIN.md](docs/COXSWAIN.md).
- Workout library (48 built-ins) and builder: single pieces, fixed, variable and unlimited
  intervals, programmed onto the PM5.
- Logbook with pacing and force-curve analysis, interval comparison, best efforts, personal
  records, trends, and a compare view. Race a previous result as a ghost.
- Tools: pace/watts calculator, race predictor, training zones, weight adjustment.
- Export CSV / TCX / JSON; full backup and restore. TCX uploads to Strava, TrainingPeaks and
  the Concept2 Logbook through their websites.
- Built-in PM5 simulator, so everything can be tried without an erg.

## Try it in a browser (no phone, no erg)

```bash
npm install
npx expo start --web
```

Open Connect, turn on "Use simulator", connect, and start a piece. Bluetooth does not work in
the browser, and browser workouts are kept in memory only (lost on reload).

## Put it on a phone

Bluetooth needs native code, so the app does **not** run in Expo Go. Build it with Expo's
cloud build service (free tier is enough; needs a free Expo account):

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform android
```

That produces an `.apk` link you open on the Android phone to install.

For iPhone, the same command with `--platform ios`. Apple requires a paid Apple Developer
account ($99/year) to install on a real iPhone; EAS walks you through registering the device.

For development with live reload, use `--profile development` and then `npx expo start`.

## Pairing

On the PM5: Menu → Connect (or More Options → Turn Wireless On). In the app: Connect → pick
the PM5 by its serial number. An optional Bluetooth heart-rate strap can be paired on the
same screen.

## Development

```bash
npm run typecheck
npm test
```

Module layout and contracts: [docs/MODULES.md](docs/MODULES.md).

## Not yet verified on hardware

The app has been tested with unit tests and in a browser against the simulator, not on a
phone with a real PM5. Things to check first on a real erg:

- Force-curve units (assumed pounds-force; the spec does not state them).
- Split numbering (assumed to start at 1).
- PM5 workout limits used by the validator (`src/workouts/validate.ts`) were not checked
  against Concept2's documentation.
- Screen-orientation locking, spoken coxswain voice, drag-and-drop in the layout editor.

Not included: online real-time racing, direct Strava / Concept2 Logbook upload, Apple Health
and Health Connect sync.

## Uploads (Strava and Concept2 Logbook)

Each service needs an API application you register yourself; no keys ship with the app. Open Settings > Connected services, type the client ID and secret, tap Connect. Credentials and tokens stay in app-private storage on the phone and are not part of backups.

- Strava: create an app at strava.com/settings/api and set Authorization Callback Domain to `oauth` (the app redirects to `openerg://oauth/strava`). Scope: `activity:write`.
- Concept2: register an app in the developer portal at log.concept2.com/developers and register the redirect URI `openerg://oauth/concept2`. New apps work on the dev server (log-dev.concept2.com, separate data) until Concept2 approves production; switch Development/Production in the app.

Per service choose Ask each time (default), Always upload or Never. Saved workouts also have an Upload card on the detail screen, with status and Retry. A workout is never uploaded twice to the same service.

## Licence

GPL-3.0, see [LICENSE](LICENSE). The Android app bundles the sherpa-onnx speech engine, which links espeak-ng (GPL-3.0),
so the app as distributed is GPL-3.0. Not affiliated with Concept2; PM5, RowErg, SkiErg and BikeErg are trademarks of Concept2.
