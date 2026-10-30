const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  tiles,
  randomIndex,
  prizeProbabilities,
  pickResult,
  cleanState,
  applyResult,
  bankRound,
  newRound,
} = require("../app/src/main/assets/game-core.js");
const start = () => cleanState(null);
const one = tiles.findIndex((tile) => tile.treats === 1);
const two = tiles.findIndex((tile) => tile.treats === 2);
const three = tiles.findIndex((tile) => tile.treats === 3);
const whammy = tiles.findIndex((tile) => tile.treats === 0);

test("Whammy chance starts at zero and rises toward, but never reaches, 100%", () => {
  const chances = [0, 1, 2, 3, 4, 10, 1000].map((spins) => {
    const prizes = prizeProbabilities(spins);
    const total = prizes.reduce((sum, prize) => sum + prize.probability, 0);
    assert.ok(Math.abs(total - 1) < 1e-12);
    return prizes.find((prize) => prize.treats === 0).probability;
  });
  const expected = [0, 1 / 3, 5 / 9, 19 / 27, 65 / 81];
  expected.forEach((chance, index) =>
    assert.ok(Math.abs(chances[index] - chance) < 1e-12),
  );
  assert.ok(chances.every((chance, index) => index === 0 || chance > chances[index - 1]));
  assert.ok(chances.at(-1) < 1);
});
test("first spin is Whammy-free and keeps the relative candy odds", () => {
  assert.deepEqual(prizeProbabilities(0), [
    { treats: 1, probability: 0.75, possible: true },
    { treats: 2, probability: 0.1875, possible: true },
    { treats: 3, probability: 0.0625, possible: true },
    { treats: 0, probability: 0, possible: false },
  ]);
  assert.equal(tiles[pickResult(0, () => 0.999)].treats, 3);
  assert.equal(tiles[pickResult(1, () => 0.999)].treats, 0);
});
test("weighted prize groups can reach every illustrated square", () => {
  const seen = new Set();
  for (const [ticket, count] of [
    [0.1, 3],
    [0.55, 4],
    [0.65, 4],
    [0.9, 5],
  ]) {
    for (let slot = 0; slot < count; slot++) {
      const randomValues = [ticket, (slot + 0.5) / count];
      let cursor = 0;
      seen.add(pickResult(1, () => randomValues[cursor++]));
    }
  }
  assert.equal(seen.size, 18);
});
test("treat winnings accumulate across as many spins as the player wants", () => {
  let state = start();
  for (const index of [one, two, three, one]) state = applyResult(state, index);
  assert.equal(state.round, 7);
  assert.equal(state.spins, 4);
  assert.equal(state.roundSpins, 4);
  assert.equal(state.over, false);
  assert.equal(state.last, one);
  assert.equal(state.lastPrize, 1);
});
test("Whammy ends the round, clears at-risk candy, and adds a consolation candy", () => {
  for (const [round, spins, roundSpins] of [
    [0, 0, 0],
    [1, 1, 0],
    [8, 5, 4],
    [40, 23, 12],
  ]) {
    const before = { ...start(), stash: 6, round, spins, roundSpins };
    assert.deepEqual(applyResult(before, whammy), {
      ...start(),
      stash: 7,
      round: 0,
      spins: spins + 1,
      roundSpins: roundSpins + 1,
      whammies: 1,
      over: true,
      loss: true,
      last: whammy,
      lastPrize: 0,
    });
  }
});
test("a Whammy result cannot spin again until a new round starts", () => {
  const state = applyResult({ ...start(), round: 9, spins: 3 }, whammy);
  assert.throws(() => applyResult(state, one), /Round is over/);
  assert.deepEqual(newRound(state), {
    ...state,
    stash: 0,
    round: 0,
    roundSpins: 0,
    over: false,
    loss: false,
    last: -1,
    lastPrize: -1,
  });
});
test("banking protects round winnings until the next round resets the total", () => {
  const winnings = applyResult(applyResult(start(), two), three);
  const banked = bankRound(winnings);
  assert.deepEqual(banked, {
    ...start(),
    stash: 5,
    spins: 2,
    roundSpins: 2,
    over: true,
    loss: false,
    last: three,
    lastPrize: 3,
  });
  assert.deepEqual(newRound(banked), {
    ...banked,
    stash: 0,
    roundSpins: 0,
    over: false,
    last: -1,
    lastPrize: -1,
  });
  assert.throws(() => bankRound(start()), /No candy to bank/);
  assert.throws(() => bankRound(banked), /Round is over/);
});
test("a new round resets consolation candy and banked candy to zero", () => {
  const whammyState = applyResult(
    { ...start(), stash: 4, round: 3 },
    whammy,
  );
  const bankedState = bankRound({ ...start(), stash: 4, round: 3 });
  assert.equal(whammyState.stash, 5);
  assert.equal(newRound(whammyState).stash, 0);
  assert.equal(newRound(whammyState).roundSpins, 0);
  assert.equal(bankedState.stash, 7);
  assert.equal(newRound(bankedState).stash, 0);
  assert.equal(newRound(bankedState).roundSpins, 0);
});
test("a long round keeps accumulating until the player stops or loses", () => {
  let state = start();
  for (let i = 0; i < 150; i++) state = applyResult(state, one);
  assert.equal(state.round, 150);
  assert.equal(state.over, false);
  assert.equal(state.spins, 150);
});
test("game state normalizes after a JSON round trip", () => {
  const state = applyResult(
    { ...start(), stash: 12, round: 5, spins: 4 },
    whammy,
  );
  assert.deepEqual(cleanState(JSON.parse(JSON.stringify(state))), state);
  const winner = applyResult(start(), three);
  assert.deepEqual(cleanState(JSON.parse(JSON.stringify(winner))), winner);
});
test("state normalization rejects malformed values", () => {
  assert.deepEqual(cleanState(null), start());
  assert.deepEqual(
    cleanState({ stash: -1, round: Infinity, spins: "3", whammies: NaN }),
    start(),
  );
  assert.deepEqual(cleanState({ stash: 4, round: 9, spins: 2, over: true }), {
    ...start(),
    stash: 4,
    spins: 2,
    over: true,
  });
  assert.equal(cleanState({ last: 900, lastPrize: -1 }).last, -1);
});
test("invalid prize indexes do not mutate the round", () => {
  const state = Object.freeze(start());
  for (const index of [-1, 18, 0.5, "1", undefined])
    assert.throws(() => applyResult(state, index), RangeError);
  assert.deepEqual(state, start());
});
test("animation selection indexes stay on the board", () => {
  for (let i = 0; i < 1000; i++) {
    const index = randomIndex(18);
    assert.ok(index >= 0 && index < 18);
    const ticket = randomIndex(400);
    assert.ok(ticket >= 0 && ticket < 400);
  }
});
