/* Weighted prize selection and round rules, shared with the Node tests. */
(function (root) {
  "use strict";
  const tiles = Object.freeze(
    [
      { treats: 1, x: 124, y: 171 },
      { treats: 2, x: 316, y: 171 },
      { treats: 3, x: 507, y: 171 },
      { treats: 3, x: 697, y: 171 },
      { treats: 0, x: 888, y: 171 },
      { treats: 0, x: 1079, y: 171 },
      { treats: 2, x: 124, y: 358 },
      { treats: 2, x: 316, y: 358 },
      { treats: 0, x: 507, y: 358 },
      { treats: 1, x: 697, y: 358 },
      { treats: 2, x: 888, y: 358 },
      { treats: 3, x: 1079, y: 358 },
      { treats: 3, x: 124, y: 545 },
      { treats: 0, x: 316, y: 545 },
      { treats: 1, x: 507, y: 545 },
      { treats: 3, x: 697, y: 545 },
      { treats: 0, x: 888, y: 545 },
      { treats: 0, x: 1079, y: 545 },
    ].map(Object.freeze),
  );
  // Reuse one canonical image per candy prize; keep the Whammy variants.
  const tileArtwork = Object.freeze({
    0: Object.freeze(tiles.filter((tile) => tile.treats === 0)),
    1: Object.freeze([
      tiles.find((tile) => tile.treats === 1 && tile.x === 124 && tile.y === 171),
    ]),
    2: Object.freeze([
      tiles.find((tile) => tile.treats === 2 && tile.x === 316 && tile.y === 171),
    ]),
    3: Object.freeze([
      tiles.find((tile) => tile.treats === 3 && tile.x === 507 && tile.y === 171),
    ]),
  });
  function prizeProbabilities(roundSpins = 0) {
    const spins = Number.isSafeInteger(roundSpins) && roundSpins > 0
      ? roundSpins
      : 0;
    // Each safe spin leaves two thirds of the remaining safe chance.
    const safeProbability = (2 / 3) ** spins;
    const oneProbability = (safeProbability * 12) / 16;
    const twoProbability = (safeProbability * 3) / 16;
    return [
      { treats: 1, probability: oneProbability, possible: true },
      { treats: 2, probability: twoProbability, possible: true },
      {
        treats: 3,
        probability: safeProbability - oneProbability - twoProbability,
        possible: true,
      },
      {
        treats: 0,
        probability: 1 - safeProbability,
        possible: spins > 0,
      },
    ];
  }

  function randomFraction() {
    const values = new Uint32Array(2);
    globalThis.crypto.getRandomValues(values);
    const bits = values[0] * 0x200000 + (values[1] >>> 11);
    return bits / 0x20000000000000;
  }

  function randomIndex(length) {
    const values = new Uint32Array(1);
    const limit = 0x100000000 - (0x100000000 % length);
    do {
      globalThis.crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return values[0] % length;
  }

  function shuffleValues(values, random) {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swapIndex = random(index + 1);
      [shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex],
        shuffled[index],
      ];
    }
    return shuffled;
  }

  function spreadValues(prizes, counts) {
    const result = new Array(tiles.length);
    prizes
      .map((prize, index) => ({ ...prize, count: counts[index], index }))
      .filter((prize) => prize.count > 0)
      .sort((left, right) => right.count - left.count || left.index - right.index)
      .forEach((prize) => {
        for (let copy = 0; copy < prize.count; copy++) {
          let position = Math.floor(((copy + 0.5) * tiles.length) / prize.count);
          while (result[position] !== undefined)
            position = (position + 1) % tiles.length;
          result[position] = prize.treats;
        }
      });
    return result;
  }

  function createTileLayout(roundSpins = 0, random = randomIndex, randomize = true) {
    const prizes = prizeProbabilities(roundSpins);
    const exactCounts = prizes.map((prize) => prize.probability * tiles.length);
    const counts = exactCounts.map(Math.floor);
    const remaining = tiles.length - counts.reduce((sum, count) => sum + count, 0);
    const remainderOrder = exactCounts
      .map((exact, index) => ({
        index,
        remainder: exact - counts[index],
      }))
      .filter(({ index }) => prizes[index].possible)
      .sort(
        (left, right) =>
          right.remainder - left.remainder || left.index - right.index,
      );
    for (let index = 0; index < remaining; index++)
      counts[remainderOrder[index].index]++;

    prizes.forEach((prize, index) => {
      if (!prize.possible || counts[index] > 0) return;
      const donor = counts
        .map((count, donorIndex) => ({
          index: donorIndex,
          excess: count - exactCounts[donorIndex],
          count,
        }))
        .filter((candidate) => candidate.index !== index && candidate.count > 1)
        .sort(
          (left, right) =>
            right.excess - left.excess || left.index - right.index,
        )[0];
      if (!donor) throw new RangeError("Cannot display every possible prize");
      counts[index] = 1;
      counts[donor.index]--;
    });

    const outcomes = prizes.flatMap((prize, index) =>
      Array(counts[index]).fill(prize.treats),
    );
    const arranged = randomize
      ? shuffleValues(outcomes, random)
      : spreadValues(prizes, counts);
    const usedArt = new Map();
    return Object.freeze(
      arranged.map((treats) => {
        const matchingArt = tileArtwork[treats];
        const used = usedArt.get(treats) ?? 0;
        usedArt.set(treats, used + 1);
        return Object.freeze({ ...matchingArt[used % matchingArt.length] });
      }),
    );
  }

  function pickPrize(roundSpins = 0, random = randomFraction) {
    let ticket = random();
    if (!Number.isFinite(ticket) || ticket < 0 || ticket >= 1)
      throw new RangeError("Invalid random ticket");
    const prizes = prizeProbabilities(roundSpins);
    for (let index = 0; index < prizes.length; index++) {
      const prize = prizes[index];
      if (ticket < prize.probability || index === prizes.length - 1)
        return prize.treats;
      ticket -= prize.probability;
    }
    throw new RangeError("Invalid random ticket");
  }

  function pickResult(roundSpins = 0, random = randomFraction) {
    const treats = pickPrize(roundSpins, random);
    const matches = tiles
      .map((tile, index) => (tile.treats === treats ? index : -1))
      .filter((index) => index >= 0);
    return matches[Math.floor(random() * matches.length)];
  }

  function cleanState(value) {
    const safe = (number) =>
      Number.isSafeInteger(number) && number >= 0 && number < 1000000000
        ? number
        : 0;
    const stash = safe(value?.stash);
    const round = safe(value?.round);
    return {
      stash,
      round: value?.over === true ? 0 : round,
      spins: safe(value?.spins),
      roundSpins: safe(value?.roundSpins),
      whammies: safe(value?.whammies),
      over: value?.over === true,
      loss: value?.over === true && value?.loss === true,
      last:
        Number.isInteger(value?.last) &&
        value.last >= 0 &&
        value.last < tiles.length
          ? value.last
          : -1,
      lastPrize:
        Number.isInteger(value?.lastPrize) &&
        value.lastPrize >= 0 &&
        value.lastPrize <= 3
          ? value.lastPrize
          : -1,
    };
  }

  function applyResult(state, index, layout = tiles) {
    if (!Number.isInteger(index) || !layout[index])
      throw new RangeError("Invalid tile");
    const current = cleanState(state);
    if (current.over) throw new Error("Round is over");
    const prize = layout[index].treats;
    return {
      stash: current.stash + (prize === 0 ? 1 : 0),
      round: prize ? current.round + prize : 0,
      spins: current.spins + 1,
      roundSpins: current.roundSpins + 1,
      whammies: current.whammies + (prize === 0 ? 1 : 0),
      over: prize === 0,
      loss: prize === 0,
      last: index,
      lastPrize: prize,
    };
  }

  function bankRound(state) {
    const current = cleanState(state);
    if (current.over) throw new Error("Round is over");
    if (current.round === 0) throw new Error("No candy to bank");
    return {
      ...current,
      stash: current.stash + current.round,
      round: 0,
      over: true,
      loss: false,
    };
  }

  function newRound(state) {
    const current = cleanState(state);
    return {
      ...current,
      stash: 0,
      round: 0,
      roundSpins: 0,
      over: false,
      loss: false,
      last: -1,
      lastPrize: -1,
    };
  }

  const api = Object.freeze({
    tiles,
    tileArtwork,
    randomIndex,
    createTileLayout,
    prizeProbabilities,
    pickPrize,
    pickResult,
    cleanState,
    applyResult,
    bankRound,
    newRound,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WhammyGame = api;
})(globalThis);
