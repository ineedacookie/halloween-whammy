const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../app/src/main/assets/esp32-bluetooth.js"),
  "utf8",
);

class CustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
}

function createBridge(initiallyConnected = false) {
  const controls = { hidden: true, open: true };
  const button = Object.assign(new EventTarget(), { disabled: false });
  const status = {};
  const elements = {
    "esp32-controls": controls,
    "esp32-connect": button,
    "esp32-status": status,
  };
  const document = Object.assign(new EventTarget(), {
    getElementById: (id) => elements[id],
  });
  const window = new EventTarget();
  const calls = [];
  const report = (message, connected, busy = false) => window.dispatchEvent(
    new CustomEvent("esp32-native-status", { detail: { message, connected, busy } }),
  );
  window.AndroidBluetooth = {
    sync() {
      calls.push("sync");
      report(initiallyConnected ? "Connected" : "Disconnected", initiallyConnected);
    },
    connect: () => calls.push("connect"),
    disconnect: () => calls.push("disconnect"),
    sendReady: () => calls.push("R"),
  };
  document.addEventListener("whammy-connect", () => calls.push("unlockAudio"));
  const navigator = {};
  Object.defineProperty(navigator, "bluetooth", {
    get() { throw new Error("Native Android must not use Web Bluetooth"); },
  });
  vm.runInNewContext(source, { window, document, navigator, TextEncoder, Event });
  return {
    controls, button, status, calls, report,
    click: () => button.dispatchEvent(new Event("click")),
    finish: () => document.dispatchEvent(new Event("whammy-roll-finished")),
  };
}

test("Android initializes from native connection state without Web Bluetooth", () => {
  const bridge = createBridge(true);
  assert.equal(bridge.controls.hidden, false);
  assert.equal(bridge.controls.open, false);
  assert.equal(bridge.status.textContent, "Connected");
  assert.equal(bridge.button.textContent, "Disconnect ESP32");
  bridge.finish();
  assert.deepEqual(bridge.calls, ["sync", "R"]);
});

test("Connect unlocks audio and waits for native permission and connection status", () => {
  const bridge = createBridge();
  bridge.click();
  assert.deepEqual(bridge.calls, ["sync", "unlockAudio", "connect"]);
  bridge.report("Allow Bluetooth access to connect.", false, true);
  assert.equal(bridge.button.disabled, true);
  bridge.finish();
  assert.equal(bridge.calls.includes("R"), false);
  bridge.report("Connected", true);
  assert.equal(bridge.button.disabled, false);
  bridge.finish();
  assert.equal(bridge.calls.at(-1), "R");
});

test("Each completed roll is acknowledged once and disconnect stops replies", () => {
  const bridge = createBridge(true);
  bridge.finish();
  bridge.finish();
  assert.equal(bridge.calls.filter((call) => call === "R").length, 2);
  bridge.click();
  assert.equal(bridge.calls.at(-1), "disconnect");
  bridge.report("Disconnected", false);
  bridge.finish();
  assert.equal(bridge.calls.filter((call) => call === "R").length, 2);
  assert.equal(bridge.button.textContent, "Connect ESP32");
});

test("Permission denial and connection loss allow retry without stale acknowledgements", () => {
  const bridge = createBridge();
  bridge.report("Bluetooth permission denied. Tap Connect to retry.", false);
  assert.equal(bridge.button.disabled, false);
  bridge.click();
  assert.equal(bridge.calls.at(-1), "connect");
  bridge.report("Connected", true);
  bridge.report("Connection lost. Reconnect ESP32.", false);
  bridge.finish();
  assert.equal(bridge.calls.includes("R"), false);
  bridge.click();
  bridge.report("Connected", true);
  bridge.finish();
  assert.equal(bridge.calls.at(-1), "R");
});
