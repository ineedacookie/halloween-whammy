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

## ESP32 buttons over Bluetooth LE

Run the browser preview and open `http://localhost:4173` in desktop Chrome
on a Bluetooth-enabled Mac or Windows computer. Power the ESP32, expand
**ESP32** at the bottom left, click **Connect ESP32**, and select the board.
Reconnect from this control after refreshing the game or losing the connection.
The connection click also enables game audio. Use localhost or HTTPS.

Chrome discovers boards that advertise the UART service UUID or a name beginning
with `Whammy` / `whammy`. The UART service and RX/TX characteristics are still
required after connection. Expand **ESP32** to see the last received button
payload and the last `R` reply; `Received: none` means no button notification
has arrived. Connection failures identify the step that failed.

The Android APK also supports the controller through native BLE. Install the
latest APK, turn on Bluetooth, expand **ESP32**, and tap **Connect ESP32**.
Allow **Nearby devices** on Android 12 or newer, then select the ESP32 from
the scan results. Android 8–11 require Location permission and the device's
Location setting for BLE discovery; the game does not collect location data.
Leaving the Android app disconnects the controller and resets the game, so
connect again when you return.

Give the firmware agent [ESP32-PROTOCOL.md](ESP32-PROTOCOL.md) for the exact
BLE service, characteristics, and button handshake. Both the computer and
Android app are BLE centrals; the ESP32 is the peripheral. There is no baud
rate for BLE. Connect the ESP32 to one game at a time.

## Project layout

- `app/src/main/assets/`: game UI, rules, sound, and original artwork.
- `app/src/main/java/com/halloweenwhammy/game/MainActivity.java`: Android shell,
  bundled asset serving, lifecycle handling, and haptics.
- `app/src/main/java/com/halloweenwhammy/game/Esp32Bluetooth.java`: native Android
  BLE discovery, permissions, notification subscription, and replies.
- `app/src/main/assets/esp32-bluetooth.js`: desktop BLE and Android bridge controls.
- `tests/game-core.test.cjs`: prize odds, round endings, banking, and state rules.
- `tests/esp32-native-bridge.test.cjs`: native connection UI and completion replies.
