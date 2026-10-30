const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../app/src/main/assets/game-core.js");
const source = fs.readFileSync(path.join(__dirname, "../app/src/main/assets/game.js"), "utf8");

class CustomEvent extends Event {
  constructor(type, options = {}) { super(type); this.detail = options.detail; }
}

function createGame() {
  let now = 0;
  let nextId = 0;
  let lose = false;
  const frames = new Map();
  const timers = new Map();
  const events = [];
  const sounds = [];
  const timeout = (callback, delay) => {
    timers.set(++nextId, { callback, at: now + delay });
    return nextId;
  };
  class Element extends EventTarget {
    constructor() {
      super();
      this.style = {};
      this.children = [];
      this.open = false;
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        replace(from, to) {
          if (classes.delete(from)) {
            classes.add(to);
            if (to === "winner") events.push({ type: "winner", at: now });
          }
        },
        toggle(name, value) { if (value) classes.add(name); else classes.delete(name); },
      };
    }
    append(child) { this.children.push(child); }
    setAttribute() {}
    showModal() { this.open = true; events.push({ type: "dialog", at: now }); }
    close() {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event("close"));
    }
  }
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    getElementById: get,
    createElement: () => new Element(),
    querySelectorAll: () => [],
  });
  document.addEventListener("whammy-roll-finished", () => events.push({ type: "R", at: now }));
  class AudioContext {
    constructor() { this.state = "running"; this.destination = {}; }
    get currentTime() { return now / 1000; }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async decodeAudioData() { return { duration: 2 }; }
    createGain() {
      const levels = [];
      return {
        levels,
        connect: (destination) => destination,
        gain: {
          setValueAtTime: (value) => levels.push(value),
          linearRampToValueAtTime: (value) => levels.push(value),
          exponentialRampToValueAtTime: (value) => levels.push(value),
        },
        disconnect() {},
      };
    }
    createSource(kind) {
      const context = this;
      const node = {
        frequency: { setValueAtTime(value) { node.pitch = value; } },
        connect(destination) { this.destination = destination; return destination; },
        start(at = context.currentTime) {
          sounds.push({ kind, at: now, scheduledAt: at * 1000,
            frequency: node.pitch, levels: node.destination.levels });
          if (kind === "clip") this.stop(context.currentTime + this.buffer.duration);
        },
        stop(at = context.currentTime) { timeout(() => node.onended?.(), (at - context.currentTime) * 1000); },
        disconnect() {},
      };
      return node;
    }
    createOscillator() { return this.createSource("tone"); }
    createBufferSource() { return this.createSource("clip"); }
  }
  const window = { AudioContext };
  vm.runInNewContext(source, {
    window, document, navigator: {}, Event, matchMedia: () => ({ matches: false }),
    performance: { now: () => now },
    setTimeout: timeout, clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (callback) => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    WhammyGame: { ...core, pickPrize: (spins) => spins && lose ? 0 : 1 },
  });
  async function frame(elapsed = 16) {
    now += elapsed;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now && timers.delete(id)) timer.callback();
    }
    for (const [id, callback] of [...frames]) {
      if (frames.delete(id)) callback(now);
    }
    await Promise.resolve();
  }
  async function until(predicate) {
    for (let count = 0; !predicate(); count++) {
      assert.ok(count < 1000, "Presentation did not reach expected state");
      await frame();
    }
  }
  return {
    get, document, events, sounds, frame, until,
    press: (command) => document.dispatchEvent(new CustomEvent("whammy-command", { detail: command })),
    lose: () => { lose = true; },
    pause: () => { document.hidden = true; window.pauseGame(); },
    resume: () => { document.hidden = false; document.dispatchEvent(new Event("visibilitychange")); },
  };
}

test("Final tile holds for 850ms before the dialog, sound, and exactly one R", async () => {
  const game = createGame();
  game.press("P");
  await game.until(() => game.events.some(({ type }) => type === "winner"));
  const selectedAt = game.events.find(({ type }) => type === "winner").at;
  for (let count = 0; count < 40; count++) await game.frame();
  game.press("P");
  game.press("S");
  assert.equal(game.get("result-dialog").open, false);
  assert.equal(game.events.filter(({ type }) => type === "R").length, 0);
  await game.until(() => game.get("result-dialog").open);
  const dialogAt = game.events.find(({ type }) => type === "dialog").at;
  assert.ok(dialogAt - selectedAt >= 850);
  assert.equal(game.get("marquee").classList.contains("result-open"), true);
  assert.equal(game.events.filter(({ type }) => type === "R").length, 1);
  const count = game.sounds.length;
  await game.frame();
  await game.frame();
  assert.ok(game.sounds.length > count, "Result sound should follow dialog rendering");
  game.press("S");
  assert.equal(game.get("marquee").classList.contains("result-open"), false);
});

test("Dropped frames do not play a burst of missed tick sounds", async () => {
  const game = createGame();
  game.press("P");
  await game.frame();
  assert.equal(game.sounds.length, 0, "Sound must not precede its visual update");
  await game.frame(500);
  assert.equal(game.sounds.length, 0);
  await game.frame();
  await game.frame();
  assert.equal(game.sounds.length, 1);
});

test("Whammy clip starts after the result is shown at 40% volume", async () => {
  const game = createGame();
  game.press("P");
  await game.until(() => game.get("result-dialog").open);
  game.lose();
  game.press("P");
  await game.until(() => game.get("result-title").textContent === "WHAMMY!");
  const dialogAt = game.events.filter(({ type }) => type === "dialog").at(-1).at;
  assert.equal(game.sounds.filter(({ kind }) => kind === "clip").length, 0);
  await game.until(() => game.sounds.some(({ kind }) => kind === "clip"));
  const clip = game.sounds.find(({ kind }) => kind === "clip");
  assert.ok(clip.at > dialogAt);
  assert.equal(Math.max(...clip.levels), 0.4);
  assert.equal(clip.levels[0], 0, "Clip should fade in instead of starting abruptly");
});

test("Pausing a roll cancels pending sounds and acknowledges only once after returning", async () => {
  const game = createGame();
  game.press("P");
  await game.frame();
  game.pause();
  for (let count = 0; count < 70; count++) await game.frame();
  assert.equal(game.sounds.length, 0);
  assert.equal(game.events.filter(({ type }) => type === "R").length, 0);
  game.resume();
  await game.frame();
  await game.frame();
  assert.equal(game.events.filter(({ type }) => type === "R").length, 1);
  assert.equal(game.sounds.length, 0, "Returning should not replay the paused roll's sounds");
});

for (const input of ["ESP32 stay", "Bank button"]) {
  test(`${input} plays one gentle banking celebration without another R`, async () => {
    const game = createGame();
    game.press("P");
    await game.until(() => game.get("result-dialog").open);
    const count = game.sounds.length;
    if (input === "ESP32 stay") game.press("S");
    else game.get("keep-button").dispatchEvent(new Event("click"));
    assert.equal(game.get("result-dialog").open, false);
    assert.equal(game.sounds.length, count, "Celebrate after the banking display updates");
    await game.frame();
    await game.frame();
    const celebration = game.sounds.slice(count);
    assert.deepEqual(celebration.map(({ frequency }) => frequency),
      [523.25, 659.25, 783.99, 1046.5, 659.25, 783.99]);
    assert.deepEqual(celebration.map(({ scheduledAt }) => Math.round(scheduledAt - celebration[0].scheduledAt)),
      [0, 120, 240, 360, 360, 360]);
    assert.ok(celebration.every(({ levels }) => Math.max(...levels) <= 0.045));
    assert.equal(game.events.filter(({ type }) => type === "R").length, 1);
    game.press("S");
    await game.frame();
    await game.frame();
    assert.equal(game.sounds.length, count + 6, "Repeated stay must not replay the celebration");
  });
}

test("A new roll cancels the previous round's pending banking celebration", async () => {
  const game = createGame();
  game.press("S");
  await game.frame();
  await game.frame();
  assert.equal(game.sounds.length, 0, "An unavailable stay action should be silent");
  game.press("P");
  await game.until(() => game.get("result-dialog").open);
  game.press("S");
  game.press("P");
  for (let count = 0; count < 6; count++) await game.frame();
  assert.equal(game.sounds.some(({ frequency }) => frequency === 523.25), false);
});

test("Banking more candy earns a longer, richer celebration at the same gentle gain", async () => {
  const lengths = [];
  for (const candy of [1, 3, 6, 10]) {
    const game = createGame();
    for (let spin = 0; spin < candy; spin++) {
      game.press("P");
      await game.until(() => game.get("result-dialog").open);
    }
    assert.equal(game.get("keep-button").textContent, `BANK ${candy} ${candy === 1 ? "CANDY" : "CANDIES"}`);
    const count = game.sounds.length;
    game.press("S");
    await game.frame();
    await game.frame();
    const celebration = game.sounds.slice(count);
    lengths.push(celebration.length);
    assert.ok(celebration.every(({ levels }) => Math.max(...levels) <= 0.045));
    assert.equal(celebration.at(-3).frequency, 1046.5, "Each melody should resolve to C");
    assert.equal(game.events.filter(({ type }) => type === "R").length, candy);
  }
  assert.deepEqual(lengths, [6, 7, 9, 11]);
});
