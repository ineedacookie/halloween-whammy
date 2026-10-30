(function () {
  "use strict";
  const {
    tiles,
    randomIndex,
    createTileLayout,
    pickPrize,
    cleanState,
    applyResult,
    bankRound,
    newRound,
  } = WhammyGame;
  const $ = (id) => document.getElementById(id);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const FINAL_TILE_HOLD_MS = 850;
  const WHAMMY_VOLUME = 0.4;
  let state = cleanState(null);
  let boardTiles = createTileLayout(state.roundSpins, randomIndex, false);
  let phase = "idle";
  let active = -1;
  let target = -1;
  let rollFrame;
  let feedbackFrame;
  let rollStartedAt;
  let nextStepAt;
  let slowStep;
  let rollId = 0;
  let revealTimer;
  let resultRevealed = false;
  let resultEffects = false;
  let audio;
  let failSound;
  let failSource;
  const tones = new Set();

  const cells = tiles.map(() => {
    const cell = document.createElement("div");
    cell.className = "tile";
    cell.setAttribute("aria-hidden", "true");
    cell.style.backgroundSize = `${(1376 / 175) * 100}% ${(768 / 175) * 100}%`;
    $("board").append(cell);
    return cell;
  });
  function paintBoard() {
    boardTiles.forEach((tile, index) => {
      cells[index].style.backgroundPosition = `${(tile.x / (1376 - 175)) * 100}% ${(tile.y / (768 - 175)) * 100}%`;
    });
  }
  paintBoard();
  const bulbCount = 54;
  document.querySelectorAll(".bulbs").forEach((strip) => {
    const count =
      strip.classList.contains("bulbs-top") ||
      strip.classList.contains("bulbs-bottom")
        ? 18
        : 9;
    const offset = strip.classList.contains("bulbs-top")
      ? 0
      : strip.classList.contains("bulbs-right")
        ? 18
        : strip.classList.contains("bulbs-bottom")
          ? 27
          : 45;
    const reverse =
      strip.classList.contains("bulbs-bottom") ||
      strip.classList.contains("bulbs-left");
    for (let i = 0; i < count; i++) {
      const bulb = document.createElement("span");
      bulb.className = "bulb";
      const position = offset + (reverse ? count - 1 - i : i);
      bulb.classList.add(position % 2 ? "bulb-odd" : "bulb-even");
      // Invert the phase so each highlight travels clockwise around the frame.
      bulb.style.animationDelay = `${-(bulbCount - 1 - position) * 50}ms`;
      strip.append(bulb);
    }
  });

  function updateControls() {
    $("spin-label").textContent = state.over ? "NEW ROUND" : "SPIN";
    $("spin-icon").textContent = "↻";
    $("spin-button").disabled = false;
  }

  function playTone(frequency, duration = 0.045, delay = 0, volume = 0.065) {
    if (!audio || audio.state !== "running") return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + delay;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(audio.destination);
    tones.add(oscillator);
    oscillator.onended = () => {
      tones.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  }

  function unlockAudio() {
    try {
      if (!audio)
        audio = new (window.AudioContext || window.webkitAudioContext)({
          latencyHint: "interactive",
        });
      if (audio.state === "suspended") audio.resume().catch(() => {});
      if (!failSound)
        failSound = fetch("fail-whammy.mp3")
          .then((response) => {
            if (!response.ok) throw new Error("Failed to load Whammy sound");
            return response.arrayBuffer();
          })
          .then((data) => audio.decodeAudioData(data))
          .catch(() => null);
    } catch {
      /* Audio is an enhancement. */
    }
  }

  function stopFailSound() {
    if (failSource) {
      failSource.stop();
      failSource = null;
    }
  }

  function playFailSound() {
    if (!failSound) return;
    const currentRoll = rollId;
    failSound.then((buffer) => {
      if (!buffer || audio.state !== "running" || phase !== "result"
          || !resultRevealed || currentRoll !== rollId) return;
      stopFailSound();
      const source = audio.createBufferSource();
      const gain = audio.createGain();
      const start = audio.currentTime;
      const fadeIn = Math.min(0.015, buffer.duration / 3);
      const fadeOut = Math.min(0.04, buffer.duration / 3);
      source.buffer = buffer;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(WHAMMY_VOLUME, start + fadeIn);
      gain.gain.setValueAtTime(WHAMMY_VOLUME, start + buffer.duration - fadeOut);
      gain.gain.linearRampToValueAtTime(0, start + buffer.duration);
      source.connect(gain).connect(audio.destination);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (failSource === source) failSource = null;
      };
      failSource = source;
      source.start();
    });
  }

  function stopSoundEffects() {
    cancelAnimationFrame(feedbackFrame);
    for (const oscillator of tones) oscillator.stop();
    tones.clear();
    stopFailSound();
  }

  function afterPaint(callback) {
    cancelAnimationFrame(feedbackFrame);
    // Give the visual update a rendering opportunity before starting its sound.
    feedbackFrame = requestAnimationFrame(() => {
      feedbackFrame = requestAnimationFrame(() => {
        if (!document.hidden) callback();
      });
    });
  }

  function highlight(index) {
    if (active >= 0) cells[active].classList.remove("active", "winner");
    active = index;
    cells[active].classList.add("active");
  }

  function nextIndex() {
    if (active < 0) return randomIndex(tiles.length);
    const next = randomIndex(tiles.length - 1);
    return next >= active ? next + 1 : next;
  }

  function weightedTarget() {
    const prize = pickPrize(state.roundSpins);
    const matches = boardTiles
      .map((tile, index) => (tile.treats === prize ? index : -1))
      .filter((index) => index >= 0);
    return matches[randomIndex(matches.length)];
  }

  function animateRoll(now) {
    if (phase !== "rolling" && phase !== "stopping") return;
    if (phase === "rolling" && now - rollStartedAt >= 1000) {
      phase = "stopping";
      nextStepAt = now;
    }
    if (now >= nextStepAt) {
      const slowing = phase === "stopping";
      const steps = reducedMotion.matches ? 3 : 10;
      if (slowing) slowStep++;
      const lastStep = slowing && slowStep === steps;
      const index = lastStep ? target : nextIndex();
      highlight(index);
      afterPaint(() => {
        if (active === index && (phase === "rolling" || phase === "stopping"
            || (phase === "result" && !resultRevealed)))
          playTone((slowing ? 430 : 450) + (index % 6) * 65, slowing ? 0.07 : 0.045);
      });
      if (lastStep) {
        finish();
        return;
      }
      // Do not replay missed ticks in a burst when a slow device drops frames.
      nextStepAt = now + (slowing
        ? 135 + Math.pow(slowStep / steps, 2) * 330
        : reducedMotion.matches ? 280 : 135);
    }
    rollFrame = requestAnimationFrame(animateRoll);
  }

  function start() {
    if (phase === "rolling" || phase === "stopping" || state.over) return;
    if (phase === "result" && !resultRevealed) return;
    $("result-dialog").close();
    clearTimeout(revealTimer);
    unlockAudio();
    stopSoundEffects();
    rollId++;
    boardTiles = createTileLayout(state.roundSpins);
    paintBoard();
    target = weightedTarget();
    phase = "rolling";
    resultRevealed = false;
    $("spin-button").hidden = true;
    $("marquee").classList.add("rolling");
    $("spin-label").textContent = "SPINNING…";
    $("spin-icon").textContent = "↻";
    $("status").textContent = "Spinning. It will stop automatically.";
    $("spin-button").disabled = true;
    rollStartedAt = performance.now();
    nextStepAt = rollStartedAt;
    slowStep = 0;
    rollFrame = requestAnimationFrame(animateRoll);
  }

  function showResult(prize) {
    if (resultRevealed || document.hidden) return;
    const whammy = prize === 0;
    const resultDialog = $("result-dialog");
    resultDialog.classList.toggle("whammy", whammy);
    resultDialog.classList.remove(
      "win-level-1",
      "win-level-2",
      "win-level-3",
      "prize-2",
      "prize-3",
    );
    const winLevel = whammy ? 0 : Math.min(state.roundSpins, 3);
    if (winLevel) resultDialog.classList.add(`win-level-${winLevel}`);
    if (prize === 2 || prize === 3) resultDialog.classList.add(`prize-${prize}`);
    $("result-sparkles").textContent = whammy
      ? "💥　⚡　💥"
      : ["", "✦　✧　✦", "✧　✦　✧　✦　✧", "✦　✧　✦　✧　✦　✧　✦"][winLevel];
    $("result-art").style.backgroundImage = `url("board-art.jpg")`;
    $("result-art").style.backgroundSize =
      `${(1376 / 175) * 100}% ${(768 / 175) * 100}%`;
    $("result-art").style.backgroundPosition =
      `${(boardTiles[target].x / (1376 - 175)) * 100}% ${(boardTiles[target].y / (768 - 175)) * 100}%`;
    $("result-art").setAttribute(
      "aria-label",
      whammy ? "Whammy" : `${prize} candy prize`,
    );
    $("result-title").textContent = whammy
      ? "WHAMMY!"
      : `+${prize} ${prize === 1 ? "CANDY" : "CANDIES"}`;
    $("result-description").textContent = whammy
      ? "Whammy ate your candies!"
      : state.roundSpins > 1
        ? `WIN STREAK ×${state.roundSpins}`
        : "";
    $("consolation").hidden = !whammy;
    $("result-actions").hidden = whammy;
    $("next-round").hidden = !whammy;
    if (!whammy) {
      $("keep-button").textContent =
        `BANK ${state.round} ${state.round === 1 ? "CANDY" : "CANDIES"}`;
      $("continue-button").textContent = "RISK IT · SPIN AGAIN  ↻";
    }
    $("result-dialog").showModal();
    $("marquee").classList.add("result-open");
    resultRevealed = true;
    if (!reducedMotion.matches) $("result-art").classList.add("reveal");
    afterPaint(() => {
      if (phase !== "result" || !resultRevealed || !resultEffects) return;
      if (prize) {
        [523, 659, 784].forEach((frequency, index) =>
          playTone(frequency, 0.22, index * 0.13),
        );
      } else playFailSound();
      if (window.AndroidHaptics) window.AndroidHaptics.pulse(prize === 0);
      else if (navigator.vibrate)
        navigator.vibrate(prize ? 45 : [140, 60, 240]);
    });
    document.dispatchEvent(new Event("whammy-roll-finished"));
  }

  function finish(playEffects = true) {
    if (phase !== "rolling" && phase !== "stopping") return;
    cancelAnimationFrame(rollFrame);
    if (target < 0) target = weightedTarget();
    if (active !== target) highlight(target);
    cells[target].classList.replace("active", "winner");
    phase = "result";
    resultEffects = playEffects;
    const prize = boardTiles[target].treats;
    state = applyResult(state, target, boardTiles);
    updateControls();
    $("marquee").classList.remove("rolling");
    $("marquee").classList.toggle("round-lost", state.loss);
    revealTimer = setTimeout(
      () => {
        if (phase !== "result" || document.hidden) return;
        showResult(prize);
      },
      FINAL_TILE_HOLD_MS,
    );
  }

  function bank() {
    if (document.hidden || phase !== "result" || !resultRevealed || state.over)
      return;
    const banked = state.round;
    try {
      state = bankRound(state);
    } catch {
      return;
    }
    updateControls();
    $("status").textContent = `Candy banked. Total stash: ${state.stash}.`;
    $("result-dialog").close();
    phase = "idle";
    $("spin-button").hidden = false;
    stopSoundEffects();
    unlockAudio();
    afterPaint(() => {
      if (phase !== "idle" || !state.over || state.loss) return;
      // A gentle ascending major arpeggio resolves into a celebratory chord.
      const notes = [523.25, 659.25, 783.99];
      if (banked >= 3) notes.push(987.77);
      if (banked >= 6) notes.push(1046.5, 1318.51);
      if (banked >= 10) notes.push(1567.98, 1318.51);
      notes.push(1046.5);
      const finalAt = (notes.length - 1) * 0.12;
      const finalDuration = 0.52 + Math.min(banked, 10) * 0.02;
      notes.forEach((frequency, index) =>
        playTone(frequency, index === notes.length - 1 ? finalDuration : 0.18,
          index * 0.12, 0.045),
      );
      [659.25, 783.99].forEach((frequency) => playTone(frequency, finalDuration, finalAt, 0.022));
    });
  }

  function nextRound() {
    stopSoundEffects();
    state = newRound(state);
    boardTiles = createTileLayout(0, randomIndex, false);
    paintBoard();
    updateControls();
    if (active >= 0) cells[active].classList.remove("active", "winner");
    active = -1;
    $("marquee").classList.remove("round-lost");
    $("result-art").classList.remove("reveal");
    $("result-dialog").close();
    phase = "idle";
    $("spin-button").hidden = false;
  }

  function press() {
    if (document.hidden || phase === "rolling" || phase === "stopping") return;
    if (phase === "result" && !resultRevealed) return;
    if (state.over) nextRound();
    start();
  }

  $("spin-button").addEventListener("click", press);
  document.addEventListener("whammy-command", ({ detail }) => {
    if (detail === "P") press();
    else if (detail === "S" && $("result-dialog").open) bank();
  });
  document.addEventListener("whammy-connect", unlockAudio);
  $("keep-button").addEventListener("click", bank);
  $("continue-button").addEventListener("click", start);
  $("next-round").addEventListener("click", nextRound);
  $("result-dialog").addEventListener("close", () => {
    $("marquee").classList.remove("result-open");
    $("result-art").classList.remove("reveal");
    if (phase === "result" && !state.over) {
      phase = "idle";
      $("spin-button").hidden = false;
    }
  });
  window.pauseGame = () => {
    stopSoundEffects();
    clearTimeout(revealTimer);
    if (phase === "rolling" || phase === "stopping") finish(false);
    if (audio) audio.suspend().catch(() => {});
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) window.pauseGame();
    else if (phase === "result" && !resultRevealed) {
      clearTimeout(revealTimer);
      showResult(state.lastPrize);
    }
  });
  updateControls();
  if (state.last >= 0 && boardTiles[state.last]?.treats === state.lastPrize) {
    active = state.last;
    cells[active].classList.add("winner");
  }
  if (state.loss) $("marquee").classList.add("round-lost");
})();
