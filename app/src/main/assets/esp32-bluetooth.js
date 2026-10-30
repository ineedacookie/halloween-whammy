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
  if (window.AndroidHaptics) return;
  controls.hidden = false;

  if (!navigator.bluetooth) {
    status.textContent = "Bluetooth unavailable. Open in desktop Chrome.";
    button.disabled = true;
    return;
  }

  function updateControls(message) {
    status.textContent = message;
    button.textContent = connection ? "Disconnect ESP32" : "Connect ESP32";
  }

  function receiveCommands(session, event) {
    if (connection !== session) return;
    const value = event.target.value;
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
    try {
      // Connecting is a user gesture, so enable audio for physical button spins.
      document.dispatchEvent(new Event("whammy-connect"));
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE] }],
      });
      session = { device, writes: Promise.resolve() };
      session.disconnect = () => release(session, "Connection lost. Reconnect ESP32.");
      session.receive = (event) => receiveCommands(session, event);
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE);
      session.rx = await service.getCharacteristic(RX);
      session.tx = await service.getCharacteristic(TX);
      if (!session.rx.properties.write || !session.tx.properties.notify)
        throw new Error("ESP32 requires RX Write and TX Notify");
      device.addEventListener("gattserverdisconnected", session.disconnect);
      session.tx.addEventListener("characteristicvaluechanged", session.receive);
      await session.tx.startNotifications();
      if (!device.gatt.connected) throw new Error("ESP32 disconnected");
      connection = session;
      updateControls("Connected");
      controls.open = false;
    } catch (error) {
      const message = error.name === "NotFoundError"
        ? "Disconnected"
        : "Cannot connect. Check ESP32 power and BLE service, then retry.";
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
      .then(() => {
        if (connection === session)
          return session.rx.writeValueWithResponse(encoder.encode("R"));
      })
      .catch(() => {
        if (connection === session) release(session, "Send failed. Reconnect ESP32.");
      });
  });
})();
