# OpenErg

OpenErg is a free Android companion app for the Concept2 PM5 monitor on RowErg, SkiErg and BikeErg.
It connects to your erg over Bluetooth, shows every metric the monitor reports, and keeps a logbook of your
workouts on the phone. There are no accounts, no subscriptions and no paywalls. Your data stays on your phone.

> **Android only for now.** An iPhone version is possible later, because it would be a port of the same code.
> Apple charges $99 a year to distribute apps to iPhones, so it is not built yet.

## Download

You do not need an Expo account or a computer to install OpenErg.

1. On your Android phone, open the [Releases page](https://github.com/TDeGuy/openerg/releases).
2. Tap the latest version and download the `.apk` file.
3. Open the file. If Android asks, allow installs from your browser or file app.

Installing a newer version over an older one keeps your workouts. You can see the installed version in
Settings → About.

## What it does

- **Live rowing screen.** Build your own pages of stat tiles and graphs. The landscape screen also shows a
  live force curve with ideal, previous and average overlays, a pace boat and splits.
- **Built-in coxswain.** Spoken pacing, technique, interval and race-plan calls. See [docs/COXSWAIN.md](docs/COXSWAIN.md).
- **Workouts.** A library of 48 built-in workouts and a builder for single pieces, fixed and variable intervals,
  and unlimited intervals. Workouts are programmed onto the PM5.
- **Logbook.** Pacing and force-curve analysis, interval comparison, best efforts, personal records, trends,
  and a compare view. You can race a previous result as a ghost.
- **Tools.** A pace and watts calculator, a race predictor, training zones and a weight adjustment.
- **Export and backup.** Export CSV, TCX or JSON files, and make a full backup that you can restore later.
- **Simulator.** A built-in PM5 simulator, so you can try everything without an erg.

## Try it in a browser

You can run OpenErg in a browser with the built-in simulator. You need no phone and no erg.

```bash
npm install
npx expo start --web
```

Open **Connect**, turn on **Use simulator**, connect, and start a piece. Bluetooth does not work in the browser,
and browser workouts are kept in memory only, so they are lost when you reload the page.

## Build it yourself

The app uses Bluetooth through native code, so it does **not** run in Expo Go. Most people should install the
`.apk` from the Releases page. To build your own copy, you need:

- Node.js 20 or newer, and a terminal open in the project folder (the one with `package.json`).
- Either a free Expo account for cloud builds, or Android Studio for building on your own computer.

### Cloud build with Expo

The project is linked to the owner's Expo account in `app.json`. Before you build, change `extra.eas.projectId`
and the owner to your own project.

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform android
```

On Windows PowerShell, use `npx.cmd` instead of `npx` if PowerShell blocks scripts.

### Build on your own computer (Windows)

See `build-apk.cmd` and `scripts/local-apk.js`. You need Android Studio, the Android SDK, long paths enabled
in Windows, and a signing key (`credentials.json`). Only the owner has the signing key. Without it, you can
still build an unsigned APK with `./gradlew assembleRelease` in `android/`, but Android will not install it
over the official version.

For development with live reload on a phone, use `--profile development`, then run `npx expo start`.

## Pairing with a PM5

On the PM5, go to **Menu → Connect** (or **More Options → Turn Wireless On**). In the app, go to **Connect**
and pick your PM5 by its serial number. You can pair an optional Bluetooth heart-rate strap on the same screen.

## Uploads: Strava and Concept2 Logbook

The in-app upload is still in progress, and it does not work end to end yet. Until it does, you can export a
TCX file from the app and upload it by hand to Strava, TrainingPeaks or the Concept2 Logbook.

If you want to help test the in-app upload, each service needs an API application that you register yourself.
No keys ship with the app.

- **Strava:** create an app at strava.com/settings/api and set the Authorization Callback Domain to `oauth`.
  The app redirects to `openerg://oauth/strava`. The scope is `activity:write`.
- **Concept2:** register an app in the developer portal at log.concept2.com/developers, and register the redirect
  URI `openerg:///oauth/concept2` (three slashes). New apps work on the development server (log-dev.concept2.com,
  separate data) until Concept2 approves production. Switch between Development and Production in the app.

In **Settings → Connected services**, enter the client ID and secret, then tap **Connect**. Credentials and tokens
stay in app-private storage on the phone and are not part of backups. For each service, choose **Ask each time**
(the default), **Always upload** or **Never**. A workout is never uploaded twice to the same service.

## Development

```bash
npm run typecheck
npm test
```

The module layout and contracts are in [docs/MODULES.md](docs/MODULES.md).

## Known gaps

OpenErg has been tested with unit tests and in a browser against the simulator. It has not yet been tested
on a phone with a real PM5 by anyone other than the owner. Please check these first on a real erg:

- Force-curve units. The code assumes pounds-force, but the spec does not state them.
- Split numbering. The code assumes splits start at 1.
- Workout limits in the validator (`src/workouts/validate.ts`) have not been checked against Concept2's documentation.
- The spoken coxswain voice, drag-and-drop in the layout editor, and the Bluetooth features beyond the basics.

The owner has confirmed the force curve and screen-orientation locking on a real PM5.

OpenErg does not do online real-time racing, Apple Health or Health Connect sync, and the in-app Strava and
Concept2 Logbook upload is not finished (see above).

## License

OpenErg is licensed under GPL-3.0. See [LICENSE](LICENSE).

The Android app bundles the sherpa-onnx speech engine, which links espeak-ng (GPL-3.0). That is why the app,
as distributed, is GPL-3.0.

OpenErg is not affiliated with Concept2. PM5, RowErg, SkiErg and BikeErg are trademarks of Concept2.
