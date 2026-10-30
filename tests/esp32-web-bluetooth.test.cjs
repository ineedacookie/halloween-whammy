const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../app/src/main/assets/esp32-bluetooth.js"), "utf8",
);
const SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

class CustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
}

function createBrowser(options = {}) {
  const controls = { hidden: true, open: true };
  const button = Object.assign(new EventTarget(), { disabled: false });
  const status = {};
  const document = Object.assign(new EventTarget(), {
    getElementById: (id) => ({
      "esp32-controls": controls, "esp32-connect": button, "esp32-status": status,
    })[id],
  });
  const window = Object.assign(new EventTarget(), { isSecureContext: !options.insecure });
  const device = Object.assign(new EventTarget(), { name: options.name || "Whammy ESP32" });
  const tx = Object.assign(new EventTarget(), {
    properties: { notify: true },
    async startNotifications() {
      if (options.subscriptionFails) throw new Error("CCCD missing");
      return this;
    },
  });
  const replies = [];
  let requested;
  let disconnects = 0;
  device.gatt = {
    connected: false,
    async connect() { this.connected = true; return this; },
    async getPrimaryService(uuid) {
      assert.equal(uuid, SERVICE);
      if (options.serviceMissing) throw new DOMException("Service missing", "NotFoundError");
      assert.ok(requested.optionalServices.includes(SERVICE), "Name discovery needs service access");
      return {
        async getCharacteristic(uuid) {
          if (options.characteristicMissing) throw new DOMException("Characteristic missing", "NotFoundError");
          if (uuid === TX) return tx;
          assert.equal(uuid, RX);
          return {
            properties: { write: true },
            async writeValueWithResponse(bytes) { replies.push(new TextDecoder().decode(bytes)); },
          };
        },
      };
    },
    disconnect() {
      this.connected = false;
      disconnects++;
      device.dispatchEvent(new Event("gattserverdisconnected"));
    },
  };
  const navigator = { bluetooth: {
    async requestDevice(value) {
      requested = value;
      if (options.cancel) throw new DOMException("Cancelled", "NotFoundError");
      const matches = value.filters.some((filter) =>
        (filter.services?.includes(SERVICE) && !options.noAdvertisedService)
          || (filter.namePrefix && device.name.startsWith(filter.namePrefix)),
      );
      if (!matches) throw new DOMException("Device filtered out", "NotFoundError");
      return device;
    },
  } };
  vm.runInNewContext(source, { window, document, navigator, TextEncoder, TextDecoder, Event, CustomEvent });
  return {
    controls, button, status, replies, document,
    get requested() { return requested; },
    get disconnects() { return disconnects; },
    async click() {
      button.dispatchEvent(new Event("click"));
      await new Promise(setImmediate);
    },
    notify(text) {
      tx.value = new DataView(new TextEncoder().encode(text).buffer);
      tx.dispatchEvent(new Event("characteristicvaluechanged"));
    },
  };
}

test("A Whammy name can discover a board that omits the UART UUID from advertising", async () => {
  const browser = createBrowser({ noAdvertisedService: true });
  await browser.click();
  assert.equal(browser.status.textContent, "Connected");
  assert.equal(browser.controls.open, false);
  assert.equal(browser.button.disabled, false);
  const commands = [];
  browser.document.addEventListener("whammy-command", ({ detail }) => commands.push(detail));
  browser.notify("p\r\ns");
  assert.deepEqual(commands, ["P", "S"]);
  browser.document.dispatchEvent(new Event("whammy-roll-finished"));
  await new Promise(setImmediate);
  assert.deepEqual(browser.replies, ["R"]);
});

test("A lowercase whammy name also works without an advertised service UUID", async () => {
  const browser = createBrowser({ name: "whammy-esp32", noAdvertisedService: true });
  await browser.click();
  assert.equal(browser.status.textContent, "Connected");
});

test("Service advertising continues to discover devices with a different name", async () => {
  const browser = createBrowser({ name: "Custom controller" });
  await browser.click();
  assert.equal(browser.status.textContent, "Connected");
});

test("Missing GATT service is reported as a firmware mismatch, not chooser cancellation", async () => {
  const browser = createBrowser({ serviceMissing: true });
  await browser.click();
  assert.match(browser.status.textContent, /UART service is unavailable/);
  assert.equal(browser.disconnects, 1);
  assert.equal(browser.button.disabled, false);
});

test("Missing characteristics and failed subscription report the failed connection step", async () => {
  const missing = createBrowser({ characteristicMissing: true });
  await missing.click();
  assert.match(missing.status.textContent, /UART characteristics do not match/);
  const subscription = createBrowser({ subscriptionFails: true });
  await subscription.click();
  assert.match(subscription.status.textContent, /notification descriptor/);
  assert.equal(subscription.disconnects, 1);
});

test("Cancelled discovery permits another connection attempt", async () => {
  const browser = createBrowser({ cancel: true });
  await browser.click();
  assert.match(browser.status.textContent, /No ESP32 selected/);
  assert.equal(browser.button.disabled, false);
  assert.equal(browser.disconnects, 0);
});

test("HTTP origins other than localhost explain the secure context requirement", () => {
  const browser = createBrowser({ insecure: true });
  assert.equal(browser.button.disabled, true);
  assert.match(browser.status.textContent, /localhost or HTTPS/);
  assert.equal(browser.requested, undefined);
});
