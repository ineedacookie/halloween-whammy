(function () {
  "use strict";
  const SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
  const controls = document.getElementById("esp32-controls");
  const button = document.getElementById("esp32-connect");
  const status = document.getElementById("esp32-status");
  const encoder = new TextEncoder();
  let connection;
  controls.hidden = false;

  if (window.AndroidBluetooth) {
    let connected = false;
    window.addEventListener("esp32-native-status", ({ detail }) => {
      connected = detail.connected;
      status.textContent = detail.message;
      button.textContent = connected ? "Disconnect ESP32" : "Connect ESP32";
      button.disabled = detail.busy;
      if (connected) controls.open = false;
    });
    button.addEventListener("click", () => {
      if (connected) window.AndroidBluetooth.disconnect();
      else {
        document.dispatchEvent(new Event("whammy-connect"));
        window.AndroidBluetooth.connect();
      }
    });
    document.addEventListener("whammy-roll-finished", () => {
      if (connected) window.AndroidBluetooth.sendReady();
    });
    window.AndroidBluetooth.sync();
    return;
  }

  if (window.isSecureContext === false) {
    status.textContent = "Bluetooth needs localhost or HTTPS. Open http://localhost:4173.";
    button.disabled = true;
    return;
  }

  if (!navigator.bluetooth) {
    status.textContent = "Bluetooth unavailable. Open in desktop Chrome.";
    button.disabled = true;
    return;
  }

  const received = document.getElementById("esp32-received");
  const reply = document.getElementById("esp32-reply");
  const diagnostics = document.getElementById("esp32-diagnostics");
  if (diagnostics) diagnostics.hidden = false;

  function updateControls(message) {
    status.textContent = message;
    button.textContent = connection ? "Disconnect ESP32" : "Connect ESP32";
  }

  function receiveCommands(session, event) {
    if (connection !== session) return;
    const value = event.target.value;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const text = JSON.stringify(new TextDecoder().decode(bytes));
    if (received) received.textContent = text.slice(0, 100);
    console.info(`ESP32 BLE received: ${text}`);
    for (let index = 0; index < value.byteLength; index++) {
      const command = String.fromCharCode(value.getUint8(index)).toUpperCase();
      if (command === "P" || command === "S")
        document.dispatchEvent(
          new CustomEvent("whammy-command", { detail: command }),
        );
    }
  }

  function release(session, message) {
    session.tx?.removeEventListener("characteristicvaluechanged", session.receive);
    session.device.removeEventListener("gattserverdisconnected", session.disconnect);
    if (session.device.gatt.connected) session.device.gatt.disconnect();
    if (connection === session) connection = null;
    updateControls(message);
  }

  button.addEventListener("click", async () => {
    if (connection) {
      release(connection, "Disconnected");
      return;
    }
    button.disabled = true;
    let session;
    let stage = "chooser";
    try {
      // Connecting is a user gesture, so enable audio for physical button spins.
      document.dispatchEvent(new Event("whammy-connect"));
      const device = await navigator.bluetooth.requestDevice({
        // Some firmware advertises its name without including the UART UUID.
        filters: [{ services: [SERVICE] }, { namePrefix: "Whammy" }, { namePrefix: "whammy" }],
        optionalServices: [SERVICE],
      });
      session = { device, writes: Promise.resolve() };
      session.disconnect = () => release(session, "Connection lost. Reconnect ESP32.");
      session.receive = (event) => receiveCommands(session, event);
      stage = "connection";
      updateControls("Connecting to ESP32…");
      const server = await device.gatt.connect();
      stage = "service";
      const service = await server.getPrimaryService(SERVICE);
      stage = "characteristics";
      session.rx = await service.getCharacteristic(RX);
      session.tx = await service.getCharacteristic(TX);
      if (!session.rx.properties.write || !session.tx.properties.notify)
        throw new Error("ESP32 requires RX Write and TX Notify");
      device.addEventListener("gattserverdisconnected", session.disconnect);
      session.tx.addEventListener("characteristicvaluechanged", session.receive);
      stage = "notifications";
      await session.tx.startNotifications();
      if (!device.gatt.connected) throw new Error("ESP32 disconnected");
      connection = session;
      if (received) received.textContent = "none";
      if (reply) reply.textContent = "none";
      updateControls("Connected");
      controls.open = false;
    } catch (error) {
      console.warn(`ESP32 Bluetooth failed during ${stage}: ${error.name}: ${error.message}`);
      let message;
      if (stage === "chooser") {
        message = error.name === "NotFoundError"
          ? "No ESP32 selected. If missing, check BLE advertising and Chrome Bluetooth permissions."
          : "Bluetooth access blocked. Allow Bluetooth in Chrome and your computer's settings.";
      } else if (stage === "service") {
        message = "ESP32 found, but its UART service is unavailable. Check the firmware service UUID.";
      } else if (stage === "characteristics") {
        message = "ESP32 UART characteristics do not match. Firmware needs RX Write and TX Notify with the documented UUIDs.";
      } else if (stage === "notifications") {
        message = "Cannot subscribe to ESP32 buttons. Check TX Notify and its notification descriptor.";
      } else {
        message = "Cannot connect to ESP32. Disconnect it from other apps or devices, restart it, and retry.";
      }
      if (session) release(session, message);
      else updateControls(message);
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener("whammy-roll-finished", () => {
    const session = connection;
    if (!session) return;
    session.writes = session.writes
      .then(async () => {
        if (connection === session) {
          await session.rx.writeValueWithResponse(encoder.encode("R"));
          if (reply) reply.textContent = "R";
          console.info("ESP32 BLE reply: R");
        }
      })
      .catch(() => {
        if (connection === session) release(session, "Send failed. Reconnect ESP32.");
      });
  });
})();
