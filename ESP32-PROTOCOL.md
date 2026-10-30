# ESP32 firmware agent handoff

Implement a **Bluetooth Low Energy (BLE) GATT peripheral** for the Halloween
Whammy browser game. The browser is the central/client. Use BLE GATT rather
than a `BluetoothSerial` Classic SPP sketch. USB is only needed for flashing
or debugging; any USB debug baud rate has no effect on BLE.

## BLE interface

Use the [Nordic UART Service UUIDs](https://nrfconnectdocs.nordicsemi.com/ncs/latest/nrf/libraries/bluetooth/services/nus.html):

| Item | UUID | Required properties / direction |
| --- | --- | --- |
| Primary service | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` | Advertise this service UUID so the browser can discover the board. |
| RX characteristic | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` | **Write with response**. Receives game → ESP32 data. |
| TX characteristic | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` | **Notify**, with notification subscription support (CCCD). Sends ESP32 → game data. |

Suggested device name: `Whammy ESP32`. Put the name in the scan response if
needed to fit the service UUID in advertising. Resume advertising after a
disconnect. Only send commands when connected and TX notifications are enabled.
The browser subscribes to TX after connecting. A GATT write response confirms
delivery of a write; it is separate from the application-level `R` message.

## Messages and button logic

Payloads are single ASCII bytes; no JSON, newline, or null terminator is needed.

| Direction | Byte | Meaning |
| --- | --- | --- |
| ESP32 → game (TX notify) | `P` (`0x50`) | Roll button pressed. |
| ESP32 → game (TX notify) | `S` (`0x53`) | Stay button pressed: bank the winnings if that option is available. |
| Game → ESP32 (RX write) | `R` (`0x52`) | Roll completed and the result is displayed; rearm the controller. |

- Debounce buttons. Send once per physical press, and require release before
  another press. Never send repeatedly while held.
- Start ready after connection/subscription. On a roll press, notify `P` and
  enter a waiting state. Suppress both button commands until `R` arrives.
- On receiving `R`, run your hardware's completion logic and rearm. Never
  echo it or automatically send another `P`. `R` contains no prize information.
- On a stay press while ready, notify `S`. Do **not** enter a waiting state:
  staying produces **no `R` reply**.
- Reset the waiting state on disconnect/reconnect. Add a watchdog (for example,
  10 seconds) to recover from a missed reply or an ignored press. On timeout,
  rearm for the next physical press; do not resend `P` automatically.
- Keep debug logging on USB, separate from BLE TX. Any `P` or `S` byte in a BLE
  debug message would be interpreted as an input. The game also accepts
  lowercase `p`/`s` and ignores CR/LF; uppercase single-byte messages are preferred.

## Game behavior the firmware can rely on

- `P` starts a spin when idle or spins again from a winning result. After
  banking or a Whammy, one `P` starts a fresh round and spins immediately.
- `S` only works while a winning result with a Bank button is displayed.
- Commands during spinning, slowing, result reveal, or while the tab is hidden
  are ignored immediately and never queued. Ignored commands receive no reply.
- One `R` is written after each finished roll, including mouse-started rolls,
  regardless of win/loss. No `R` is sent merely for connecting or banking.
  If the tab is hidden mid-roll, completion is reported when the user returns
  and the result is shown. The watchdog covers that delay.
- The user connects through the game's **Connect ESP32** button in desktop
  Chrome on localhost or HTTPS. The game uses
  [Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth).

Hardware acceptance check: connect → press roll → exactly one `P` → exactly one
`R` → press roll again or stay. Verify held/bouncing buttons cannot repeat spins,
stay during a spin does nothing, and reconnecting recovers from a missing reply.
