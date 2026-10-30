# Halloween Whammy

An offline Android candy game built around the supplied Halloween board. The
prize board fills the mobile screen in portrait and landscape, with a centered
spin button over the board.
Tap Spin to roll for one second; it then slows and stops automatically. Choose
to bank the round's winnings or risk them on another spin.
Each successful spin reveals the selected square in a large prize card. Rounds
can continue until a Whammy: that ends the round, wipes its unbanked candy, and
adds one consolation candy to the stash. The candy total resets to zero when a
new round starts. Leaving the app discards the round and stash; returning starts
a fresh game.

The first spin of each round cannot land on a Whammy. After each safe spin, the
next spin takes one third of the remaining safe probability as Whammy risk. The
remaining chance is split between 1, 2, and 3 candies in a 12:3:1 ratio. The
board is a visual guide: every possible prize has at least one square, while
weighted outcome selection uses the full probabilities independently of the
18-square layout. No account, network access, ads, or purchases.

## Install on Android

The built test APK is at `app/build/outputs/apk/debug/app-debug.apk`. Copy it to
an Android phone, open the file, and allow installation from that source when
Android asks. Requires Android 8.0 or later with an updated Android System WebView.

## Build

Open this folder in Android Studio and let it install the requested SDK, or use
Java 17 and an Android SDK with platform 35:

```sh
export ANDROID_HOME=/path/to/your/android-sdk
./gradlew :app:assembleDebug :app:lintDebug
```

## Preview and test

Node.js and Python 3 are sufficient; there are no npm dependencies to install.

```sh
npm test
npm run preview
```

Open `http://127.0.0.1:4173`. The preview uses the same game and artwork shipped
in the APK. Android also adds haptics. The app supports portrait, landscape, and
reduced-motion settings.

## Project layout

- `app/src/main/assets/`: game UI, rules, sound, and original artwork.
- `app/src/main/java/com/halloweenwhammy/game/MainActivity.java`: Android shell,
  bundled asset serving, lifecycle handling, and haptics.
- `tests/game-core.test.cjs`: prize odds, round endings, banking, and state rules.
