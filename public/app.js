class GameSocket {
  constructor() {
    this.ws = null;
    this.pending = new Map();
    this.handlers = {};
    this.msgId = 0;
    this.roomCode = null;
    this.opening = null;
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  wsUrl(code) {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${location.host}/ws/${encodeURIComponent(code)}`;
  }

  connect(code) {
    const normalized = String(code || "").trim().toUpperCase();
    if (this.ws && this.roomCode === normalized && this.ws.readyState <= 1) {
      return Promise.resolve();
    }
    this.close();
    this.roomCode = normalized;
    this.opening = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl(normalized));
      this.ws = ws;
      ws.addEventListener("open", () => {
        this.opening = null;
        resolve();
        this.handlers.connect?.();
      });
      ws.addEventListener("message", (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data?.id !== undefined && this.pending.has(data.id)) {
          const { resolve: done, reject: fail } = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (data.ok) done(data);
          else {
            const error = new Error(data.error || "Request failed.");
            if (data.code) error.code = data.code;
            if (data.bots) error.bots = data.bots;
            fail(error);
          }
          return;
        }
        if (data?.event && this.handlers[data.event]) this.handlers[data.event](data.payload);
      });
      ws.addEventListener("close", () => {
        if (this.ws === ws) this.ws = null;
      });
      ws.addEventListener("error", () => {
        if (this.opening) {
          this.opening = null;
          reject(new Error("Could not connect to the room."));
        }
      });
    });
    return this.opening;
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* ignore */ }
    }
    this.ws = null;
    this.roomCode = null;
    for (const { reject } of this.pending.values()) reject(new Error("Disconnected."));
    this.pending.clear();
  }

  async emit(event, payload = {}) {
    if (event === "create_room") {
      const response = await fetch("/api/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Could not create room.");
      await this.connect(data.code);
      const joined = await this.emit("join_room", { code: data.code, token: data.token, name: payload.name, avatarId: payload.avatarId });
      return { ...data, ...joined };
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const code = payload.code || this.roomCode || storedSession?.code;
      if (!code) throw new Error("Join a room first.");
      await this.connect(code);
    }

    const id = String(++this.msgId);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, event, payload }));
    });
  }
}

const socket = new GameSocket();
const $ = (selector) => document.querySelector(selector);
const home = $("#home");
const game = $("#game");
const homeError = $("#home-error");
const gameError = $("#game-error");
const symbols = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" };
const suitOrder = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };
let state = null;
let previousState = null;
let previousHandIds = new Set();
let handAutoSlideKey = "";
let firstFiveScrollKey = "";
let lastManualHandScrollAt = 0;
let programmaticHandScrollUntil = 0;
let storedSession = JSON.parse(localStorage.getItem("courtPieceSession") || "null");
const tableThemes = ["noir", "comic", "neon", "adda", "gully", "atelier"];
const gameTypes = ["court-piece", "judgment", "rummy"];
const gameMeta = {
  "court-piece": { label: "Court Piece", eyebrow: "COURT PIECE", scoreA: "Team A", scoreB: "Team B" },
  judgment: { label: "Judgment", eyebrow: "JUDGMENT", scoreA: "P1", scoreB: "P2" },
  rummy: { label: "Rummy", eyebrow: "RUMMY", scoreA: "P1", scoreB: "P2" }
};
const avatarIds = ["kadki-king", "chai-champion", "jugaadu", "sher", "filmy-villain", "office-babu", "cool-aunty", "biker-didi", "glam-queen", "bollywood-boss"];
const createThemeStorageKey = "courtPieceCreateTheme";
const avatarStorageKey = "courtPieceAvatar";
const effectsMutedStorageKey = "courtPieceEffectsMuted";
const effectsIntensityStorageKey = "courtPieceEffectsIntensity";
const gameTypeStorageKey = "courtPieceGameType";
let selectedGameType = normalizeGameType(localStorage.getItem(gameTypeStorageKey) || "court-piece");
let createTableTheme = normalizeTableTheme(localStorage.getItem(createThemeStorageKey)
  || document.querySelector('input[name="create-table-theme"]:checked')?.value);
let selectedRoomAvatar = normalizeAvatarId(localStorage.getItem(avatarStorageKey) || storedSession?.avatarId);
let effectsMuted = localStorage.getItem(effectsMutedStorageKey) === "true";
let effectsIntensity = localStorage.getItem(effectsIntensityStorageKey) || "medium";
let lastEnabledEffectsIntensity = ["off", "0"].includes(String(effectsIntensity).toLowerCase()) ? "medium" : effectsIntensity;
let audioUnlockPending = false;
let pendingBidValue = null;
let pendingBidKey = "";
let roomAvailabilityTimer = null;
let roomAvailabilityRequest = 0;
let hukumStoryTimer = null;
const effectStreaks = {
  trick: { team: null, count: 0 },
  round: { team: null, count: 0 }
};

function normalizeTableTheme(value) {
  const theme = String(value || "").trim().toLowerCase();
  return tableThemes.includes(theme) ? theme : "noir";
}

function isAtelierTheme() {
  return normalizeTableTheme(state?.tableTheme || createTableTheme) === "atelier";
}

function reducedMotionEnabled() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function normalizeGameType(value) {
  const gameType = String(value || "").trim().toLowerCase();
  return gameTypes.includes(gameType) ? gameType : "court-piece";
}

function selectedGame(name = "game-type") {
  return normalizeGameType(document.querySelector('input[name="' + name + '"]:checked')?.value || selectedGameType);
}

function gameLabel(gameType = state?.gameType || selectedGameType) {
  return gameMeta[normalizeGameType(gameType)]?.label || "Court Piece";
}

function normalizeAvatarId(value) {
  const avatarId = String(value || "").trim().toLowerCase();
  return avatarIds.includes(avatarId) ? avatarId : avatarIds[0];
}

function selectedAvatar(name, fallback = avatarIds[0]) {
  return normalizeAvatarId(document.querySelector(`input[name="${name}"]:checked`)?.value || fallback);
}

function syncAvatarRadios(name, value, disabled = false, available = avatarIds) {
  const avatarId = normalizeAvatarId(value);
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === avatarId;
    input.disabled = disabled || !available.includes(input.value);
  });
}

function saveAvatarSelection(value) {
  selectedRoomAvatar = normalizeAvatarId(value);
  localStorage.setItem(avatarStorageKey, selectedRoomAvatar);
  if (state && storedSession?.code === state.code && storedSession.role !== "spectator") {
    storedSession.avatarId = selectedRoomAvatar;
    localStorage.setItem("courtPieceSession", JSON.stringify(storedSession));
  }
  syncAvatarRadios("create-avatar", selectedRoomAvatar);
  return selectedRoomAvatar;
}

function initialsFor(name) {
  return String(name || "P").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "P";
}

function avatarMarkup(player) {
  const avatarId = normalizeAvatarId(player?.avatarId);
  return `<div class="avatar ${player?.bot ? "bot-avatar" : ""}" data-avatar="${avatarId}" data-profile-replacement="true" style="--avatar-image:url('assets/avatars/${avatarId}.webp')" aria-label="${player.name}'s selected profile"><span class="avatar-fallback" aria-hidden="true">${initialsFor(player.name)}</span></div>`;
}

function applyTableTheme(value) {
  const theme = normalizeTableTheme(value);
  document.documentElement.dataset.tableTheme = theme;
  if (document.body) document.body.dataset.tableTheme = theme;
  return theme;
}

function selectedTheme(name, fallback = "noir") {
  return normalizeTableTheme(document.querySelector(`input[name="${name}"]:checked`)?.value || fallback);
}

function syncThemeRadios(name, value, disabled = false) {
  const theme = normalizeTableTheme(value);
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === theme;
    input.disabled = disabled;
  });
}

function readAuctionMode(element, fallback = false) {
  if (!element) return Boolean(fallback);
  if (element.type === "checkbox" || element.type === "radio") return element.checked;
  return ["true", "1", "auction", "on"].includes(String(element.value).toLowerCase());
}

function saveCreateTheme(theme) {
  createTableTheme = normalizeTableTheme(theme);
  localStorage.setItem(createThemeStorageKey, createTableTheme);
  syncThemeRadios("create-table-theme", createTableTheme);
  if (!state) applyTableTheme(createTableTheme);
}

function effectsApi() {
  return window.GameEffects || null;
}

function initializeEffects() {
  const effects = effectsApi();
  if (!effects) return null;
  effects.init({ getTheme: () => state?.tableTheme || createTableTheme });
  effects.setMuted(effectsMuted);
  effects.setIntensity(effectsIntensity);
  return effects;
}

function resetEffectStreaks(all = true) {
  effectStreaks.trick = { team: null, count: 0 };
  if (all) effectStreaks.round = { team: null, count: 0 };
}

function nextEffectStreak(kind, team) {
  const tracker = effectStreaks[kind];
  if (tracker.team === team) tracker.count += 1;
  else {
    tracker.team = team;
    tracker.count = 1;
  }
  return tracker.count;
}

function visualEffectsEnabled() {
  const value = String(effectsIntensity).trim().toLowerCase();
  return value !== "off" && value !== "0" && Number(effectsIntensity) !== 0;
}

function setEffectsMuted(value) {
  effectsMuted = Boolean(value);
  localStorage.setItem(effectsMutedStorageKey, String(effectsMuted));
  initializeEffects()?.setMuted(effectsMuted);
  syncEffectsControls();
}

function setEffectsIntensity(value) {
  effectsIntensity = value;
  if (visualEffectsEnabled()) lastEnabledEffectsIntensity = value;
  localStorage.setItem(effectsIntensityStorageKey, String(effectsIntensity));
  initializeEffects()?.setIntensity(effectsIntensity);
  syncEffectsControls();
}

function syncEffectsControls() {
  const soundToggle = $("#sound-toggle");
  const effectsToggle = $("#effects-toggle");
  const muteControl = $("#effects-mute");
  const intensityControl = $("#effects-intensity");
  if (soundToggle) soundToggle.checked = !effectsMuted;
  if (effectsToggle) effectsToggle.checked = visualEffectsEnabled();
  if (muteControl) {
    if (muteControl.type === "checkbox") muteControl.checked = effectsMuted;
    else muteControl.setAttribute("aria-pressed", String(effectsMuted));
  }
  if (intensityControl && "value" in intensityControl) intensityControl.value = String(effectsIntensity);
}

function bindOptionalControls() {
  syncThemeRadios("create-table-theme", createTableTheme);
  document.querySelectorAll('input[name="create-table-theme"]').forEach((input) => {
    input.onchange = () => {
      if (!input.checked) return;
      saveCreateTheme(input.value);
      applyTableTheme(input.value);
    };
  });

  syncAvatarRadios("create-avatar", selectedRoomAvatar);
  document.querySelectorAll('input[name="create-avatar"]').forEach((input) => {
    input.onchange = () => {
      if (input.checked) saveAvatarSelection(input.value);
    };
  });

  const soundToggle = $("#sound-toggle");
  if (soundToggle) soundToggle.onchange = () => setEffectsMuted(!soundToggle.checked);

  const effectsToggle = $("#effects-toggle");
  if (effectsToggle) effectsToggle.onchange = () => {
    setEffectsIntensity(effectsToggle.checked ? lastEnabledEffectsIntensity : "off");
  };

  const muteControl = $("#effects-mute");
  if (muteControl) {
    if (muteControl.type === "checkbox") muteControl.onchange = () => setEffectsMuted(muteControl.checked);
    else muteControl.onclick = () => setEffectsMuted(!effectsMuted);
  }

  const intensityControl = $("#effects-intensity");
  if (intensityControl) {
    const updateIntensity = () => setEffectsIntensity(intensityControl.value);
    intensityControl.oninput = updateIntensity;
    intensityControl.onchange = updateIntensity;
  }
  syncEffectsControls();
}

async function unlockEffectsAudio() {
  const effects = initializeEffects();
  if (!effects || audioUnlockPending) return;
  audioUnlockPending = true;
  try {
    if (await effects.unlockAudio()) {
      document.removeEventListener("pointerdown", unlockEffectsAudio, true);
      document.removeEventListener("keydown", unlockEffectsAudio, true);
    }
  } finally {
    audioUnlockPending = false;
  }
}

function emit(event, payload = {}) {
  return socket.emit(event, payload);
}

function setError(element, error) {
  element.textContent = error?.message || "";
  if (error) setTimeout(() => { element.textContent = ""; }, 3000);
}

async function previewRoomAvailability() {
  const code = $("#room-code").value.trim().toUpperCase();
  const result = $("#room-availability");
  const joinButton = $("#join-button");
  const requestId = ++roomAvailabilityRequest;
  result.classList.add("hidden");
  result.replaceChildren();
  joinButton.textContent = "Join table";
  if (code.length !== 5) return;

  try {
    const response = await fetch(`/api/room/${encodeURIComponent(code)}`);
    const info = await response.json().catch(() => null);
    if (requestId !== roomAvailabilityRequest) return;
    if (!info?.ok) {
      result.textContent = "Room not found";
      result.className = "room-availability is-error";
      return;
    }
    const humans = (info.players || []).filter((player) => player && !player.bot).length;
    const bots = info.bots || [];
    const empty = info.emptySeats || [];
    result.className = "room-availability";
    if (bots.length) {
      result.innerHTML = `<strong>${bots.length} bot${bots.length === 1 ? "" : "s"} available</strong><span>${empty.length ? `${empty.length} open seat${empty.length === 1 ? "" : "s"} first` : "Tap Join, then choose the seat you replace"}</span>`;
      if (!empty.length) joinButton.textContent = "Join & replace bot";
    } else if (empty.length) {
      result.innerHTML = `<strong>${empty.length} seat${empty.length === 1 ? "" : "s"} open</strong><span>${humans}/4 people at this table</span>`;
    } else {
      result.innerHTML = "<strong>Human table is full</strong><span>You can still watch as spectator</span>";
    }
  } catch (_) {
    if (requestId !== roomAvailabilityRequest) return;
    result.textContent = "Could not check this room yet";
    result.className = "room-availability is-error";
  }
}

function saveSession(result, name) {
  const role = result.role || "player";
  storedSession = {
    code: result.code,
    token: result.token,
    name,
    role,
    ...(role === "spectator" ? {} : { avatarId: normalizeAvatarId(result.avatarId || selectedRoomAvatar) })
  };
  localStorage.setItem("courtPieceSession", JSON.stringify(storedSession));
  history.replaceState(null, "", `?room=${result.code}`);
}

async function enterRoom(kind) {
  homeError.textContent = "";
  const name = $("#name").value.trim();
  try {
    const avatarId = selectedAvatar("create-avatar", selectedRoomAvatar);
    if (kind === "create") {
      const result = await emit("create_room", {
        name,
        avatarId,
        gameType: selectedGame(),
        tableTheme: selectedTheme("create-table-theme", createTableTheme),
        auctionMode: readAuctionMode($("#create-auction-mode") || $("#auction-mode"), false)
      });
      saveCreateTheme(result.tableTheme || selectedTheme("create-table-theme", createTableTheme));
      saveAvatarSelection(result.avatarId || avatarId);
      saveSession(result, name);
      return;
    }

    const code = $("#room-code").value.trim().toUpperCase();
    if (!code) throw new Error("Enter a room code.");

    if (kind === "spectator") {
      await socket.connect(code);
      const result = await emit("join_spectator", { code, name });
      saveSession(result, name);
      return;
    }

    const infoResponse = await fetch(`/api/room/${encodeURIComponent(code)}`);
    const info = await infoResponse.json().catch(() => null);
    let replaceSeat;
    if (info?.ok && !info.emptySeats?.length && info.bots?.length) {
      replaceSeat = await pickBotSeat(info.bots);
      if (replaceSeat === null) return;
    }

    await socket.connect(code);
    try {
      const result = await emit("join_room", { code, name, avatarId, replaceSeat });
      saveAvatarSelection(result.avatarId || avatarId);
      saveSession(result, name);
    } catch (error) {
      if (error.code === "CHOOSE_BOT" && error.bots?.length) {
        const seat = await pickBotSeat(error.bots);
        if (seat === null) return;
        const result = await emit("join_room", { code, name, avatarId, replaceSeat: seat });
        saveAvatarSelection(result.avatarId || avatarId);
        saveSession(result, name);
        return;
      }
      throw error;
    }
  } catch (error) { setError(homeError, error); }
}

function pickBotSeat(bots) {
  return new Promise((resolve) => {
    const picker = $("#bot-picker");
    const options = $("#bot-picker-options");
    options.innerHTML = bots.map((bot) =>
      `<button type="button" data-seat="${bot.seat}">
        <span class="bot-picker-avatar" style="--avatar-image:url('assets/avatars/${normalizeAvatarId(bot.avatarId)}.webp')"></span>
        <span class="bot-picker-copy"><strong>${bot.name}</strong><small>Team ${bot.team ? "B" : "A"} · Seat ${bot.seat + 1}</small></span>
        <b>Take seat</b>
      </button>`
    ).join("");
    picker.classList.remove("hidden");
    const cleanup = (value) => {
      picker.classList.add("hidden");
      options.onclick = null;
      $("#bot-picker-cancel").onclick = null;
      resolve(value);
    };
    options.onclick = (event) => {
      const button = event.target.closest("button[data-seat]");
      if (!button) return;
      cleanup(Number(button.dataset.seat));
    };
    $("#bot-picker-cancel").onclick = () => cleanup(null);
  });
}

function confirmHostKick(player) {
  return new Promise((resolve) => {
    const dialog = $("#host-action-dialog");
    $("#host-action-title").textContent = `Remove ${player.name}?`;
    $("#host-action-note").textContent = state.round && state.round.phase !== "round_over"
      ? "Their connection will close and a bot will finish the active seat."
      : "Their seat will become open for another friend to join.";
    dialog.classList.remove("hidden");
    const cleanup = (value) => {
      dialog.classList.add("hidden");
      $("#host-action-cancel").onclick = null;
      $("#host-action-confirm").onclick = null;
      resolve(value);
    };
    $("#host-action-cancel").onclick = () => cleanup(false);
    $("#host-action-confirm").onclick = () => cleanup(true);
  });
}

function setOverlayOpen(element, trigger, open) {
  if (!element || !trigger) return;
  trigger.setAttribute("aria-expanded", String(open));
  if (open) {
    element.classList.remove("hidden");
    if (window.gsap && !reducedMotionEnabled()) {
      gsap.fromTo(element, { autoAlpha: 0, y: -12, scale: 0.985 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.28, ease: "power3.out", clearProps: "transform,opacity,visibility" });
    }
  } else if (window.gsap && !reducedMotionEnabled()) {
    gsap.to(element, { autoAlpha: 0, y: -10, duration: 0.18, ease: "power2.in", onComplete: () => {
      element.classList.add("hidden");
      gsap.set(element, { clearProps: "transform,opacity,visibility" });
    } });
  } else element.classList.add("hidden");
}

function closeHudDrawer() {
  setOverlayOpen($("#hud-drawer"), $("#hud-toggle"), false);
}

function closeFxLab() {
  setOverlayOpen($("#fx-lab"), $("#fx-lab-toggle"), false);
}

function createFxDemoCard(card, className) {
  const holder = document.createElement("div");
  holder.innerHTML = cardHtml(card, { disabled: true });
  const element = holder.firstElementChild;
  element.classList.add("fx-demo-source", className);
  $(".table")?.appendChild(element);
  return element;
}

function runAtelierCardPlayDemo() {
  const table = $(".table");
  if (!table || !window.gsap) return;
  const demo = createFxDemoCard({ id: "demo-play", rank: "Q", suit: "diamonds" }, "fx-demo-play-card");
  const tableRect = table.getBoundingClientRect();
  const start = $("#seat-0 .avatar")?.getBoundingClientRect();
  const targetX = tableRect.width * 0.5 - demo.offsetWidth * 0.5;
  const targetY = tableRect.height * 0.54 - demo.offsetHeight * 0.5;
  gsap.set(demo, {
    left: start ? start.left - tableRect.left : tableRect.width * 0.5,
    top: start ? start.top - tableRect.top : tableRect.height,
    rotationY: 68,
    rotation: 14,
    scale: 0.55,
    autoAlpha: 0
  });
  gsap.to(demo, { left: targetX, top: targetY, rotationY: 0, rotation: -4, scale: 1, autoAlpha: 1, duration: 0.62, ease: "power3.out" });
  gsap.to(demo, { autoAlpha: 0, scale: 0.9, duration: 0.2, delay: 1.05, onComplete: () => demo.remove() });
}

async function runFxDemo(kind) {
  const effects = initializeEffects();
  if (!effects) return;
  await effects.unlockAudio?.();
  effects.setIntensity("high");
  const table = $(".table");
  const localTeam = isSpectator() ? 0 : state?.players[state?.you?.seat]?.team || 0;
  const payload = { team: localTeam, isLocal: true, element: table, streak: kind === "lightning" ? 3 : 1 };

  if (kind === "card") {
    if (isAtelierTheme()) runAtelierCardPlayDemo();
    else effects.onCardPlay(payload);
  } else if (kind === "lightning") {
    effects.onTrumpCut({ ...payload, forceLightning: true });
  } else if (kind === "ace-cut") {
    const ace = createFxDemoCard({ id: "demo-ace", rank: "A", suit: "spades" }, "fx-demo-ace-card");
    const hukum = createFxDemoCard({ id: "demo-hukum", rank: "9", suit: "hearts" }, "fx-demo-hukum-card");
    effects.onTrumpCut({ ...payload, aceCut: true, forceLightning: true, aceElement: ace, element: hukum });
    window.setTimeout(() => { ace.remove(); hukum.remove(); }, 2200);
  } else if (kind === "trick") effects.onTrickWin(payload);
  else if (kind === "round") effects.onRoundWin(payload);
  else if (kind === "match") effects.onMatchWin(payload);
}

function bindGameSelector() {
  document.querySelectorAll('input[name="game-type"]').forEach((input) => {
    input.checked = input.value === selectedGameType;
    input.onchange = () => {
      if (!input.checked) return;
      selectedGameType = normalizeGameType(input.value);
      localStorage.setItem(gameTypeStorageKey, selectedGameType);
      document.body.dataset.gameType = selectedGameType;
    };
  });
  document.body.dataset.gameType = selectedGameType;
}

$("#create-button").addEventListener("click", () => enterRoom("create"));
$("#join-button").addEventListener("click", () => enterRoom("join"));
$("#spectate-button").addEventListener("click", () => enterRoom("spectator"));
$("#room-code").addEventListener("keydown", (event) => { if (event.key === "Enter") enterRoom("join"); });
$("#room-code").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  window.clearTimeout(roomAvailabilityTimer);
  roomAvailabilityTimer = window.setTimeout(previewRoomAvailability, 180);
});
bindGameSelector();

$("#start-button").addEventListener("click", () => emit("start_game").catch((error) => setError(gameError, error)));
$("#fill-bots-button").addEventListener("click", () => emit("fill_bots")
  .then(() => toast("Empty seats filled with bots"))
  .catch((error) => setError(gameError, error)));
$("#next-button").addEventListener("click", () => emit("next_round").catch((error) => setError(gameError, error)));
$("#pass-button").addEventListener("click", () => emit("pass_trump").catch((error) => setError(gameError, error)));
$("#reveal-button").addEventListener("click", () => emit("reveal_trump").catch((error) => setError(gameError, error)));
$("#restart-button").addEventListener("click", () => emit("request_restart").catch((error) => setError(gameError, error)));
$("#accept-restart").addEventListener("click", () => emit("respond_restart", { accept: true }).catch((error) => setError(gameError, error)));
$("#decline-restart").addEventListener("click", () => emit("respond_restart", { accept: false }).catch((error) => setError(gameError, error)));
$("#accept-team-switch")?.addEventListener("click", () => emit("respond_team_switch", { accept: true }).catch((error) => setError(gameError, error)));
$("#decline-team-switch")?.addEventListener("click", () => emit("respond_team_switch", { accept: false }).catch((error) => setError(gameError, error)));
$("#transfer-host-button")?.addEventListener("click", () => {
  const seat = Number($("#transfer-host-select")?.value);
  emit("transfer_host", { seat })
    .then(() => toast("Host transferred"))
    .catch((error) => setError(gameError, error));
});

function returnToHome(message = "") {
  socket.close();
  localStorage.removeItem("courtPieceSession");
  storedSession = null;
  previousState = null;
  state = null;
  pendingBidValue = null;
  pendingBidKey = "";
  clearTimeout(hukumStoryTimer);
  hukumStoryTimer = null;
  resetEffectStreaks();
  effectsApi()?.reset();
  game.classList.add("hidden");
  home.classList.remove("hidden");
  $("#room-code").value = "";
  $("#room-availability")?.classList.add("hidden");
  applyTableTheme(createTableTheme);
  history.replaceState(null, "", location.pathname);
  if (message) toast(message);
}

$("#exit-button").addEventListener("click", async () => {
  if (!window.confirm("Exit this room? Your seat will free up (or become a bot if a round is in progress).")) return;
  try { await emit("leave_room"); } catch (_) { /* leave locally even if connection dropped */ }
  returnToHome();
});
$("#copy-code").addEventListener("click", shareInvite);
$("#share-button").addEventListener("click", shareInvite);
$("#watch-player").addEventListener("change", (event) => emit("watch_player", { seat: event.target.value }).catch((error) => setError(gameError, error)));
$("#hud-toggle")?.addEventListener("click", () => {
  const trigger = $("#hud-toggle");
  const open = trigger.getAttribute("aria-expanded") !== "true";
  closeFxLab();
  setOverlayOpen($("#hud-drawer"), trigger, open);
});
$("#hud-close")?.addEventListener("click", closeHudDrawer);
$("#fx-lab-toggle")?.addEventListener("click", () => {
  const trigger = $("#fx-lab-toggle");
  const open = trigger.getAttribute("aria-expanded") !== "true";
  closeHudDrawer();
  setOverlayOpen($("#fx-lab"), trigger, open);
});
$("#fx-lab-close")?.addEventListener("click", closeFxLab);
$("#fx-lab")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-fx-demo]");
  if (!button) return;
  runFxDemo(button.dataset.fxDemo).catch((error) => setError(gameError, error));
});

async function shareInvite() {
  const url = `${location.origin}${location.pathname}?room=${state.code}`;
  try {
    if (navigator.share) await navigator.share({ title: "Court Piece", text: `Join my Court Piece room ${state.code}`, url });
    else await navigator.clipboard.writeText(url);
    toast("Invite link copied");
  } catch (_) { /* share sheet dismissed */ }
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 1800);
}

function cardHtml(card, options = {}) {
  const red = card.suit === "hearts" || card.suit === "diamonds";
  const style = [
    options.rotate !== undefined ? `--card-rotate:${options.rotate}deg` : "",
    options.arc !== undefined ? `--card-arc:${options.arc}px` : ""
  ].filter(Boolean).join(";");
  return `<button class="card ${red ? "red" : ""} ${options.playable ? "playable" : ""} ${options.dealt ? "dealt" : ""}" ${options.disabled ? "disabled" : ""} data-card="${card.id}" ${options.seat === undefined ? "" : `data-seat="${options.seat}"`} ${options.owner ? `data-owner="${options.owner}"` : ""} ${style ? `style="${style}"` : ""}>
    <span class="corner corner-top">${card.rank}<span class="corner-suit">${symbols[card.suit]}</span></span>
    <span class="pip">${symbols[card.suit]}</span>
    <span class="corner corner-bottom">${card.rank}<span class="corner-suit">${symbols[card.suit]}</span></span>
  </button>`;
}

function bindHandScrollTracking(hand) {
  if (hand.dataset.scrollTracking === "true") return;
  const markManualScroll = () => { lastManualHandScrollAt = Date.now(); };
  hand.addEventListener("pointerdown", markManualScroll, { passive: true });
  hand.addEventListener("touchstart", markManualScroll, { passive: true });
  hand.addEventListener("wheel", markManualScroll, { passive: true });
  hand.addEventListener("scroll", () => {
    if (Date.now() > programmaticHandScrollUntil) markManualScroll();
  }, { passive: true });
  hand.dataset.scrollTracking = "true";
}

function scrollHandTo(hand, left, smooth = false) {
  const target = Math.max(0, Math.min(left, Math.max(0, hand.scrollWidth - hand.clientWidth)));
  programmaticHandScrollUntil = Date.now() + (smooth ? 700 : 120);
  try {
    hand.scrollTo({ left: target, behavior: smooth ? "smooth" : "auto" });
  } catch (_) {
    hand.scrollLeft = target;
  }
}

function autoPositionHand(hand, round, sorted, firstFive, leadSuit, hasLead) {
  bindHandScrollTracking(hand);

  const firstDealKey = firstFive && sorted.length === 5
    ? `${state.code}:${round.dealer}:${perspectiveSeat()}`
    : "";
  if (firstDealKey && firstDealKey !== firstFiveScrollKey) {
    firstFiveScrollKey = firstDealKey;
    scrollHandTo(hand, 0);
  }

  const completedTricks = (round.collectedBySeat || []).reduce((total, count) => total + count, 0);
  const leadWasPlayedByViewer = round.trick[0]?.seat === perspectiveSeat();
  const slideKey = leadSuit && hasLead && !leadWasPlayedByViewer
    ? `${state.code}:${round.dealer}:${completedTricks}:${perspectiveSeat()}:${leadSuit}`
    : "";
  if (!slideKey || slideKey === handAutoSlideKey) return;
  handAutoSlideKey = slideKey;

  // A swipe/wheel already in progress wins over automation for this trick.
  if (Date.now() - lastManualHandScrollAt < 800) return;
  const targetCard = sorted.find((card) => card.suit === leadSuit);
  if (!targetCard) return;

  requestAnimationFrame(() => {
    if (handAutoSlideKey !== slideKey || !hand.isConnected) return;
    const target = Array.from(hand.querySelectorAll("[data-card]"))
      .find((card) => card.dataset.card === targetCard.id);
    if (!target) return;
    const leftEdge = target.offsetLeft;
    const rightEdge = leftEdge + target.offsetWidth;
    const visibleLeft = hand.scrollLeft;
    const visibleRight = visibleLeft + hand.clientWidth;
    if (leftEdge >= visibleLeft && rightEdge <= visibleRight) return;
    const centeredLeft = leftEdge - (hand.clientWidth - target.offsetWidth) / 2;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    scrollHandTo(hand, centeredLeft, !reducedMotion);
  });
}

function isSpectator() {
  return state?.you?.role === "spectator";
}

function perspectiveSeat() {
  return isSpectator() ? (state.you.watchingSeat ?? 0) : state.you.seat;
}

function relativeSeat(absoluteSeat) {
  return (absoluteSeat - perspectiveSeat() + 4) % 4;
}

function renderSeats() {
  const isNewDeal = Boolean(state.round) && (!previousState?.round || previousState.round.dealer !== state.round.dealer);
  for (let absolute = 0; absolute < 4; absolute += 1) {
    const position = relativeSeat(absolute);
    const player = state.players[absolute];
    const element = $(`#seat-${position}`);
    const isTurn = state.round && (
      state.round.phase === "playing" && state.round.turn === absolute
      || state.round.phase === "calling" && state.round.turn === absolute
      || state.round.phase === "bidding" && state.round.bidState?.turn === absolute
      || state.round.phase === "auction_decision" && state.round.bidState?.decisionSeat === absolute
      || state.round.phase === "choosing_trump" && state.round.caller === absolute
    );
    const remaining = state.round?.handCounts[absolute] || 0;
    const collected = state.round?.collectedBySeat?.[absolute] || 0;
    const collectedChanged = collected > (previousState?.round?.collectedBySeat?.[absolute] || 0);
    const cardBacks = state.round && absolute !== perspectiveSeat() && remaining
      ? `<div class="seat-cards ${isNewDeal ? "dealt" : ""}" aria-label="${remaining} cards remaining"><i></i><i></i><i></i><span>${remaining}</span></div>`
      : "";
    const pile = collected
      ? `<div class="captured-pile ${collectedChanged ? "new-capture" : ""}" title="${collected} won trick${collected === 1 ? "" : "s"}"><i></i><i></i><span>${collected}</span></div>`
      : "";
    element.className = `seat seat-${["bottom", "left", "top", "right"][position]} ${isTurn ? "active" : ""} ${player && !player.connected ? "offline" : ""} ${absolute === state.hostSeat ? "host-seat" : ""}`;
    const canAskSwitch = !isSpectator()
      && state.canTeamSwitch
      && player
      && !player.bot
      && absolute !== state.you.seat
      && player.team !== state.players[state.you.seat]?.team
      && !state.teamSwitchRequest;
    const switchButton = canAskSwitch
      ? `<button class="seat-switch-button secondary" type="button" data-switch-seat="${absolute}">Request switch</button>`
      : "";
    const canKick = !isSpectator()
      && state.you.seat === state.hostSeat
      && player
      && absolute !== state.you.seat
      && (!state.round || state.round.phase === "round_over" || !player.bot);
    const kickButton = canKick
      ? `<button class="seat-kick-button" type="button" data-kick-seat="${absolute}" aria-label="Remove ${player.name} from table">Remove</button>`
      : "";
    element.innerHTML = player
      ? `${pile}${kickButton}${avatarMarkup(player)}<div class="seat-nameplate"><span class="seat-player-name">${player.name}${player.bot ? " <span class=\"bot-tag\">BOT</span>" : ""}${absolute === state.hostSeat ? " <span class=\"bot-tag\">HOST</span>" : ""}${!isSpectator() && absolute === state.you.seat ? " (you)" : isSpectator() && absolute === perspectiveSeat() ? " (watching)" : ""}</span><span class="team">${state.gameType === "court-piece" ? `Team ${player.team ? "B" : "A"}` : `Seat ${absolute + 1}`}</span></div>${switchButton}${cardBacks}`
      : `<div class="avatar empty-avatar">+</div><div class="seat-nameplate"><span class="seat-player-name">Empty seat</span></div>`;
    element.querySelector("[data-switch-seat]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      emit("request_team_switch", { targetSeat: Number(event.currentTarget.dataset.switchSeat) })
        .then(() => toast("Switch requested"))
        .catch((error) => setError(gameError, error));
    });
    element.querySelector("[data-kick-seat]")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      const targetSeat = Number(event.currentTarget.dataset.kickSeat);
      const target = state.players[targetSeat];
      if (!target || !(await confirmHostKick(target))) return;
      emit("kick_player", { seat: targetSeat })
        .then((result) => toast(result.replacedWithBot ? `${target.name} removed · bot took the active seat` : `${target.name} removed`))
        .catch((error) => setError(gameError, error));
    });
  }
}

function animateAtelierDeal(hand) {
  if (!isAtelierTheme() || reducedMotionEnabled() || !window.gsap) return;
  const cards = [...hand.querySelectorAll(".card.dealt")];
  if (!cards.length) return;

  requestAnimationFrame(() => {
    const table = $(".table");
    const tableRect = table?.getBoundingClientRect();
    if (!tableRect?.width) return;
    const originX = tableRect.left + tableRect.width * 0.5;
    const originY = tableRect.top + tableRect.height * 0.51;
    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const x = originX - (rect.left + rect.width / 2);
      const y = originY - (rect.top + rect.height / 2);
      try {
        gsap.fromTo(card,
          { x, y, scale: 0.16, rotation: (index - cards.length / 2) * 5, rotationY: 50, autoAlpha: 0 },
          { x: 0, y: 0, scale: 1, rotation: 0, rotationY: 0, autoAlpha: 1, duration: 0.64, delay: index * 0.055, ease: "back.out(1.45)", clearProps: "x,y,rotation,rotationY,opacity,visibility" }
        );
      } catch (_) { /* CSS deal animation remains available. */ }
    });
  });
}

function animateAtelierTrickCapture(winnerSeat) {
  if (!isAtelierTheme() || reducedMotionEnabled() || !window.gsap || winnerSeat === null || winnerSeat === undefined) return;
  const target = $("#seat-" + relativeSeat(winnerSeat) + " .avatar");
  const cards = [...document.querySelectorAll(".trick .played-card")];
  const targetRect = target?.getBoundingClientRect();
  if (!targetRect?.width || !cards.length) return;

  const targetX = targetRect.left + targetRect.width / 2;
  const targetY = targetRect.top + targetRect.height / 2;
  try {
    const timeline = gsap.timeline({ delay: 0.38 });
    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      timeline.to(card, {
        x: targetX - (rect.left + rect.width / 2),
        y: targetY - (rect.top + rect.height / 2),
        scale: 0.2,
        rotation: (index - cards.length / 2) * 16,
        autoAlpha: 0,
        duration: 0.52,
        ease: "power3.in"
      }, index * 0.035);
    });
    timeline.fromTo(target, { scale: 1 }, { scale: 1.14, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out" }, 0.46);
  } catch (_) { /* The resolved trick remains readable without motion. */ }
}

function renderHand() {
  const hand = $("#hand");
  const round = state.round;
  const label = $("#hand-label");
  if (!round?.hand?.length) {
    hand.innerHTML = "";
    hand.style.removeProperty("--hand-card-count");
    delete hand.dataset.cardCount;
    label.classList.add("hidden");
    previousHandIds = new Set();
    handAutoSlideKey = "";
    firstFiveScrollKey = "";
    lastManualHandScrollAt = 0;
    return;
  }
  label.classList.remove("hidden");
  const owner = state.players[perspectiveSeat()]?.name || "Player";
  const firstFive = ["choosing_trump", "bidding", "auction_decision"].includes(round.phase);
  label.textContent = isSpectator()
    ? `${owner}'s ${firstFive ? "first five cards" : `hand · ${round.hand.length} cards`}`
    : firstFive ? "Your first five cards" : `Your hand · ${round.hand.length} cards`;
  const leadSuit = round.trick[0]?.card.suit;
  const hasLead = leadSuit && round.hand.some((card) => card.suit === leadSuit);
  const isRummy = state.gameType === "rummy";
  const sorted = [...round.hand].sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit] || a.value - b.value);
  const mid = (sorted.length - 1) / 2;
  const angleStep = sorted.length > 1 ? Math.min(1.5, 12 / (sorted.length - 1)) : 0;
  hand.innerHTML = sorted.map((card, index) => {
    const legal = isRummy || round.phase !== "playing" || !leadSuit || card.suit === leadSuit || !hasLead;
    const hiddenChoice = !isSpectator() && round.phase === "choosing_trump" && round.mode === "hidden" && round.caller === state.you.seat;
    const playable = !isSpectator() && (hiddenChoice || (isRummy
      ? round.phase === "playing" && round.turn === state.you.seat && round.drawnThisTurn
      : round.phase === "playing" && round.turn === state.you.seat && legal));
    const offset = index - mid;
    const rotate = Math.round(offset * angleStep * 10) / 10;
    const arc = -Math.round(Math.abs(offset) * Math.abs(offset) * 0.2);
    const dealt = !previousHandIds.has(card.id);
    return cardHtml(card, { playable, disabled: !playable, rotate, arc, dealt });
  }).join("");
  hand.style.removeProperty("width");
  hand.style.removeProperty("max-width");
  hand.style.setProperty("--hand-card-count", String(sorted.length));
  hand.dataset.cardCount = String(sorted.length);
  hand.querySelectorAll(".card").forEach((card, index) => {
    card.style.zIndex = index + 1;
    card.style.setProperty("--card-index", String(index));
    if (card.classList.contains("dealt")) card.style.animationDelay = `${index * 45}ms`;
  });
  autoPositionHand(hand, round, sorted, firstFive, leadSuit, hasLead);
  animateAtelierDeal(hand);
  previousHandIds = new Set(sorted.map((card) => card.id));
  hand.querySelectorAll("[data-card]").forEach((card) => card.addEventListener("click", () => {
    card.blur();
    requestAnimationFrame(() => window.scrollTo(0, 0));
    if (isSpectator()) return;
    if (round.phase === "choosing_trump" && round.mode === "hidden") emit("choose_hidden_trump", { cardId: card.dataset.card }).catch((error) => setError(gameError, error));
    else if (round.phase === "playing" && isRummy) emit("discard_card", { cardId: card.dataset.card }).catch((error) => setError(gameError, error));
    else if (round.phase === "playing") emit("play_card", { cardId: card.dataset.card }).catch((error) => setError(gameError, error));
  }));
}

function renderTrick() {
  const trick = $("#trick");
  const resolved = state.round?.phase === "trick_complete";
  trick.classList.toggle("resolved", resolved);
  trick.innerHTML = (state.round?.trick || []).map((play) => {
    const relative = relativeSeat(play.seat);
    return cardHtml(play.card, { seat: relative, owner: state.players[play.seat].name }).replace('class="card', 'class="card played-card');
  }).join("") + (resolved ? `<div class="trick-winner">${state.players[state.round.pendingWinner].name} takes it</div>` : "");
}

function renderTeamPicker() {
  const teamA = $("#team-a-button");
  const teamB = $("#team-b-button");
  if (!teamA && !teamB) return;
  const currentTeam = isSpectator() ? null : state.players[state.you.seat]?.team;
  [[teamA, 0], [teamB, 1]].forEach(([button, team]) => {
    if (!button) return;
    const selected = currentTeam === team;
    button.classList.toggle("selected", selected);
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = isSpectator() || Boolean(state.round);
    button.onclick = () => emit("choose_team", { team }).catch((error) => setError(gameError, error));
  });
  [0, 1].forEach((team) => {
    const roster = $(`#team-${team ? "b" : "a"}-roster`);
    if (!roster) return;
    const names = state.players
      .filter((player) => player?.team === team)
      .map((player) => player.bot ? `${player.name} · bot` : player.name);
    roster.textContent = names.length ? names.join(" · ") : "2 seats open";
  });
}

function renderAvatarPicker() {
  const available = state.options?.avatarIds || avatarIds;
  const current = !isSpectator() ? normalizeAvatarId(state.players[state.you.seat]?.avatarId) : selectedRoomAvatar;
  if (!isSpectator()) saveAvatarSelection(current);
  const canChoose = !isSpectator() && !state.round;
  document.querySelectorAll('input[name="room-avatar"]').forEach((input) => {
    input.checked = input.value === current;
    input.disabled = !canChoose || !available.includes(input.value);
    input.onchange = () => {
      if (!input.checked || !canChoose) return;
      const nextAvatar = saveAvatarSelection(input.value);
      emit("choose_avatar", { avatarId: nextAvatar }).catch((error) => {
        syncAvatarRadios("room-avatar", current, !canChoose, available);
        saveAvatarSelection(current);
        setError(gameError, error);
      });
    };
  });
}

function lobbySettingsPayload() {
  const deckSelect = $("#deck-size");
  const modeSelect = $("#game-mode");
  const auctionControl = $("#auction-mode");
  return {
    deckSize: Number(deckSelect?.value || state.settings.deckSize),
    mode: modeSelect?.value || state.settings.mode,
    tableTheme: selectedTheme("table-theme", state.tableTheme),
    auctionMode: readAuctionMode(auctionControl, state.settings.auctionMode)
  };
}

function updateLobbySettings() {
  if (!state || state.round || isSpectator() || state.you.seat !== state.hostSeat) return;
  const updates = lobbySettingsPayload();
  applyTableTheme(updates.tableTheme);
  emit("update_settings", updates).catch((error) => {
    applyTableTheme(state.tableTheme);
    syncThemeRadios("table-theme", state.tableTheme);
    setError(gameError, error);
  });
}

function renderLobbySettings(host) {
  const deckSelect = $("#deck-size");
  const modeSelect = $("#game-mode");
  const auctionControl = $("#auction-mode");
  const isCourtPiece = state.gameType === "court-piece";
  document.querySelector("#lobby-panel .settings-grid")?.classList.toggle("hidden", !isCourtPiece);
  document.querySelector("#lobby-panel .auction-setting")?.classList.toggle("hidden", !isCourtPiece);
  if (deckSelect) {
    const deckSizes = state.options?.deckSizes || [state.settings.deckSize];
    deckSelect.innerHTML = deckSizes.map((size) => `<option value="${size}" ${size === state.settings.deckSize ? "selected" : ""}>${size} cards · ${size / 4} each</option>`).join("");
    deckSelect.disabled = !host;
    deckSelect.onchange = updateLobbySettings;
  }
  if (modeSelect) {
    modeSelect.value = state.settings.mode;
    modeSelect.disabled = !host;
    modeSelect.onchange = updateLobbySettings;
  }
  if (auctionControl) {
    if (auctionControl.type === "checkbox" || auctionControl.type === "radio") auctionControl.checked = Boolean(state.settings.auctionMode);
    else auctionControl.value = String(Boolean(state.settings.auctionMode));
    auctionControl.disabled = !host;
    auctionControl.onchange = updateLobbySettings;
  }

  const availableThemes = state.options?.tableThemes || tableThemes;
  document.querySelectorAll('input[name="table-theme"]').forEach((input) => {
    input.checked = input.value === state.tableTheme;
    input.disabled = !host || !availableThemes.includes(input.value);
    input.onchange = () => {
      if (!input.checked) return;
      applyTableTheme(input.value);
      updateLobbySettings();
    };
  });
}

function readBidValue(element) {
  if (!element) return pendingBidValue;
  return Number("value" in element ? element.value : element.textContent);
}

function writeBidValue(element, value) {
  if (!element) return;
  if ("value" in element) element.value = String(value);
  else element.textContent = String(value);
}

function clampBid(value, minimum, maximum) {
  const numeric = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(numeric) ? Math.round(numeric) : minimum));
}

function renderBiddingPanel() {
  const round = state.round;
  const bid = round?.bidState;
  const panel = $("#auction-panel");
  if (!panel || !bid) return;

  const title = $("#auction-title");
  const contract = $("#auction-contract");
  const status = $("#bid-status");
  const history = $("#bid-history");
  const bidControls = $("#auction-bid-controls");
  const decisionPanel = $("#auction-decision");
  const decisionTitle = $("#auction-decision-title");
  const decisionCopy = $("#auction-decision-copy");
  const keep = $("#keep-auction-button");
  const give = $("#give-auction-button");
  const value = $("#bid-value");
  const decrease = $("#bid-decrease");
  const increase = $("#bid-increase");
  const place = $("#place-bid-button");
  const pass = $("#pass-bid-button");
  const deciding = round.phase === "auction_decision";
  const turnName = bid.turn === null ? "Auction complete" : state.players[bid.turn]?.name || "Player";
  const bidderName = bid.highestBidder === null ? "No bidder yet" : state.players[bid.highestBidder]?.name || "Player";
  const bidderTeam = bid.highestBidder === null ? null : state.players[bid.highestBidder]?.team;
  const decisionName = bid.decisionSeat === null ? "Original caller" : state.players[bid.decisionSeat]?.name || "Original caller";
  const highest = bid.highestBid === null ? `Opening bid ${bid.minimumBid}` : `High bid ${bid.highestBid} · ${bidderName}`;
  const yourTurn = Boolean(bid.canBid || bid.canPass);
  const contractBid = bid.contractBid ?? bid.highestBid;
  const contractLabel = Number.isFinite(Number(contractBid)) ? String(contractBid) : "the high bid";
  if (title) title.textContent = deciding ? "Who keeps the hukum?" : "Bid for the contract";
  if (contract) contract.textContent = contractBid === null
    ? "Bidding open"
    : `Team ${bidderTeam ? "B" : "A"} · ${bidderName} · ${contractBid}`;
  if (status) {
    status.textContent = deciding
      ? bid.canDecide
        ? `${bidderName} leads at ${contractLabel} · Your decision`
        : `Waiting for ${decisionName} · ${bidderName} leads at ${contractLabel}`
      : `${highest} · ${yourTurn ? "Your turn" : `Waiting for ${turnName}`}`;
  }

  if (history) {
    history.replaceChildren();
    const entries = bid.history || [];
    if (!entries.length) {
      history.appendChild(Object.assign(document.createElement("li"), { className: "bid-history-empty", textContent: "No bids yet" }));
    } else {
      entries.forEach((entry) => {
        const playerState = state.players[entry.seat];
        const player = playerState?.name || `Seat ${entry.seat + 1}`;
        const team = playerState?.team ? "B" : "A";
        const action = entry.action === "pass"
          ? "Passed"
          : entry.action === "forced_bid"
            ? `Opened ${entry.bid}`
            : entry.action === "keep"
              ? `Kept ${entry.bid}`
              : entry.action === "give"
                ? "Gave contract"
                : `Bid ${entry.bid}`;
        const item = document.createElement("li");
        item.className = `bid-history-item ${entry.action === "pass" ? "is-pass" : "is-bid"}`;
        const identity = document.createElement("span");
        identity.className = "bid-history-player";
        const name = document.createElement("strong");
        name.textContent = player;
        const teamLabel = document.createElement("small");
        teamLabel.textContent = `Team ${team}`;
        identity.append(name, teamLabel);
        const actionLabel = document.createElement("b");
        actionLabel.className = "bid-history-action";
        actionLabel.textContent = action;
        item.append(identity, actionLabel);
        history.appendChild(item);
      });
    }
  }

  bidControls?.classList.toggle("hidden", deciding);
  decisionPanel?.classList.toggle("hidden", !deciding);
  if (deciding) {
    if (decisionTitle) {
      decisionTitle.textContent = bid.canDecide
        ? "Keep Hukum or give it away?"
        : `${decisionName} must keep or give`;
    }
    if (decisionCopy) {
      decisionCopy.textContent = bid.canDecide
        ? `Keep Hukum matches ${bidderName}'s ${contractLabel}-trick bid for your team. Give transfers both the contract and hukum choice to ${bidderName}.`
        : `${decisionName} can match the ${contractLabel}-trick bid to keep hukum, or give the contract and hukum choice to ${bidderName}.`;
    }
    if (keep) {
      keep.textContent = `Keep Hukum · Match ${contractLabel}`;
      keep.disabled = !bid.canKeep;
      keep.onclick = async () => {
        keep.disabled = true;
        if (give) give.disabled = true;
        try { await emit("decide_auction", { decision: "keep" }); }
        catch (error) {
          setError(gameError, error);
          keep.disabled = !bid.canKeep;
          if (give) give.disabled = !bid.canGive;
        }
      };
    }
    if (give) {
      give.textContent = `Give to ${bidderName}`;
      give.setAttribute("aria-label", `Give hukum to highest bidder ${bidderName}`);
      give.disabled = !bid.canGive;
      give.onclick = async () => {
        give.disabled = true;
        if (keep) keep.disabled = true;
        try { await emit("decide_auction", { decision: "give" }); }
        catch (error) {
          setError(gameError, error);
          give.disabled = !bid.canGive;
          if (keep) keep.disabled = !bid.canKeep;
        }
      };
    }
    return;
  }

  if (keep) keep.onclick = null;
  if (give) give.onclick = null;
  const minimum = Number(bid.nextMinimumBid ?? bid.minimumBid);
  const maximum = Number(bid.maximumBid);
  const key = `${state.code}:${round.dealer}:${bid.turn}:${bid.history?.length || 0}:${minimum}:${maximum}`;
  if (pendingBidKey !== key) {
    pendingBidKey = key;
    pendingBidValue = clampBid(minimum, minimum, maximum);
  } else pendingBidValue = clampBid(readBidValue(value), minimum, maximum);
  writeBidValue(value, pendingBidValue);
  if (value && "min" in value) value.min = String(minimum);
  if (value && "max" in value) value.max = String(maximum);
  if (value && "disabled" in value) value.disabled = !bid.canBid;

  const updateButtons = () => {
    writeBidValue(value, pendingBidValue);
    if (decrease) decrease.disabled = !bid.canBid || pendingBidValue <= minimum;
    if (increase) increase.disabled = !bid.canBid || pendingBidValue >= maximum;
    if (place) place.disabled = !bid.canBid;
    if (pass) pass.disabled = !bid.canPass;
  };
  if (value && "onchange" in value) value.onchange = () => {
    pendingBidValue = clampBid(readBidValue(value), minimum, maximum);
    updateButtons();
  };
  if (decrease) decrease.onclick = () => {
    pendingBidValue = clampBid(pendingBidValue - 1, minimum, maximum);
    updateButtons();
  };
  if (increase) increase.onclick = () => {
    pendingBidValue = clampBid(pendingBidValue + 1, minimum, maximum);
    updateButtons();
  };
  if (place) place.onclick = async () => {
    pendingBidValue = clampBid(readBidValue(value), minimum, maximum);
    writeBidValue(value, pendingBidValue);
    place.disabled = true;
    try { await emit("place_bid", { bid: pendingBidValue }); }
    catch (error) { setError(gameError, error); updateButtons(); }
  };
  if (pass) pass.onclick = async () => {
    pass.disabled = true;
    try { await emit("pass_bid"); }
    catch (error) { setError(gameError, error); updateButtons(); }
  };
  updateButtons();
}

function renderJudgmentPanel() {
  const panel = $("#judgment-panel");
  if (!panel) return;
  panel.classList.add("hidden");
  if (state.gameType !== "judgment" || state.round?.phase !== "calling") return;
  panel.classList.remove("hidden");
  const yourTurn = !isSpectator() && state.round.turn === state.you.seat && state.round.calls?.[state.you.seat] === null;
  const caller = state.players[state.round.turn]?.name || "Player";
  $("#judgment-call-status").textContent = yourTurn ? "Choose one number. No second chance." : `${caller} is making a call`;
  const options = $("#judgment-call-options");
  options.innerHTML = Array.from({ length: 13 }, (_, index) => index + 1).map((call) =>
    `<button type="button" class="call-option" data-call="${call}" ${yourTurn ? "" : "disabled"}>${call}<small>trick${call === 1 ? "" : "s"}</small></button>`
  ).join("");
  options.querySelectorAll("[data-call]").forEach((button) => {
    button.onclick = () => emit("place_call", { call: Number(button.dataset.call) }).catch((error) => setError(gameError, error));
  });
}

function renderRummyPanel() {
  const panel = $("#rummy-panel");
  if (!panel) return;
  panel.classList.add("hidden");
  if (state.gameType !== "rummy" || state.round?.phase !== "playing") return;
  panel.classList.remove("hidden");
  const yourTurn = !isSpectator() && state.round.turn === state.you.seat;
  const stock = $("#rummy-draw-stock");
  const discard = $("#rummy-draw-discard");
  const canDraw = yourTurn && !state.round.drawnThisTurn;
  stock.disabled = !canDraw;
  discard.disabled = !canDraw || !state.round.discardTop;
  $("#rummy-status").textContent = yourTurn
    ? state.round.drawnThisTurn ? "Now tap one card in your hand to discard." : "Pick a pile to draw from."
    : `${state.players[state.round.turn]?.name || "Player"} is arranging a hand`;
  stock.onclick = () => emit("draw_card", { source: "stock" }).catch((error) => setError(gameError, error));
  discard.onclick = () => emit("draw_card", { source: "discard" }).catch((error) => setError(gameError, error));
}

function renderPanels() {
  const lobby = $("#lobby-panel");
  const trump = $("#trump-panel");
  const result = $("#round-panel");
  const auction = $("#auction-panel");
  const judgment = $("#judgment-panel");
  const rummy = $("#rummy-panel");
  lobby.classList.toggle("hidden", Boolean(state.round) || isSpectator());
  // Keep full lobby setup only before first start; between rounds use seat switch controls.
  if (state.round) lobby.classList.add("hidden");
  trump.classList.add("hidden");
  result.classList.add("hidden");
  auction?.classList.add("hidden");
  judgment?.classList.add("hidden");
  rummy?.classList.add("hidden");
  renderTeamPicker();
  renderAvatarPicker();
  renderHostTransfer();
  renderTeamSwitchPanel();
  document.querySelector(".team-choice-block")?.classList.toggle("hidden", state.gameType !== "court-piece");
  const lobbyIntro = document.querySelector("#lobby-panel .panel-intro");
  if (lobbyIntro) lobbyIntro.textContent = state.gameType === "court-piece"
    ? "Share the code, pick the vibe, then choose your side."
    : `Share the code and start a ${gameLabel(state.gameType)} table.`;

  if (!state.round && !isSpectator()) {
    const count = state.players.filter(Boolean).length;
    $("#start-button").classList.toggle("hidden", state.you.seat !== state.hostSeat);
    $("#start-button").disabled = count !== 4;
    const botCount = state.players.filter((player) => player?.bot).length;
    $("#lobby-note").textContent = `${count}/4 seats ready${botCount ? ` · ${botCount} bot${botCount > 1 ? "s" : ""}` : ""}${state.you.seat === state.hostSeat ? " — you are the host" : ""}`;
    const host = state.you.seat === state.hostSeat;
    $("#fill-bots-button").classList.toggle("hidden", !host || count === 4);
    renderLobbySettings(host && !state.settingsLocked);
  } else if (state.round && ["bidding", "auction_decision"].includes(state.round.phase)) {
    auction?.classList.remove("hidden");
    renderBiddingPanel();
  } else if (!isSpectator() && state.round?.phase === "choosing_trump" && state.round.caller === state.you.seat) {
    trump.classList.remove("hidden");
    const hidden = state.round.mode === "hidden";
    $("#trump-help").textContent = hidden ? "Tap one of your five cards. Its suit stays secret." : "Pick a suit after seeing your first five cards.";
    $("#suit-buttons").classList.toggle("hidden", hidden);
    if (!hidden) {
      $("#suit-buttons").innerHTML = state.suits.map((suit) => `<button class="suit-button ${(suit === "hearts" || suit === "diamonds") ? "red" : ""}" data-suit="${suit}" aria-label="${suit}">${symbols[suit]}</button>`).join("");
      $("#suit-buttons").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => emit("choose_trump", { suit: button.dataset.suit }).catch((error) => setError(gameError, error))));
    }
    $("#pass-button").classList.toggle("hidden", !state.round.canPass);
  } else if (state.round?.gameType === "judgment" && state.round.phase === "calling") {
    renderJudgmentPanel();
  } else if (state.round?.gameType === "rummy" && state.round.phase === "playing") {
    renderRummyPanel();
  } else if (state.round?.phase === "round_over") {
    result.classList.remove("hidden");
    const won = !isSpectator() && (state.gameType === "court-piece"
      ? state.round.winner === state.players[state.you.seat].team
      : state.round.winner === state.you.seat);
    const contract = state.round.bidState?.contractBid
      ? `<br><span class="contract-result ${state.round.bidState.contractMade ? "made" : "failed"}">Team ${state.round.bidState.contractTeam ? "B" : "A"} contract ${state.round.bidState.contractBid} · ${state.round.bidState.contractMade ? "MADE" : "FAILED"}</span>`
      : "";
    if (state.gameType === "court-piece") {
      $("#round-result").innerHTML = `<strong>${isSpectator() ? `Team ${state.round.winner ? "B" : "A"} wins the deal.` : won ? "Your team wins the deal." : "Other team wins the deal."}</strong><br>Hands ${state.round.tricks[0]}–${state.round.tricks[1]} · Score ${state.score[0]}–${state.score[1]}${contract}`;
    } else if (state.gameType === "judgment") {
      $("#round-result").innerHTML = `<strong>${isSpectator() ? `${state.players[state.round.winner]?.name || "Player"} wins the call.` : won ? "You won the call." : "The table has spoken."}</strong><br>Calls ${state.round.calls.join(" · ")} · Tricks ${state.round.tricks.join("–")} · Round ${state.round.roundScores.join(" · ")}`;
    } else {
      $("#round-result").innerHTML = `<strong>${isSpectator() ? `${state.players[state.round.winner]?.name || "Player"} declared.` : won ? "You declared a valid hand." : "Someone found the run."}</strong><br>Penalty scores ${state.round.roundScores.join(" · ")}`;
    }
    $("#next-button").classList.toggle("hidden", isSpectator() || state.you.seat !== state.hostSeat);
    $("#next-button").textContent = "Deal next round";
  }
  $("#reveal-button").classList.toggle("hidden", !state.round?.canRevealTrump);

  const restartPanel = $("#restart-panel");
  const vote = isSpectator() ? null : state.restartVote;
  restartPanel.classList.toggle("hidden", !vote);
  $("#restart-button").classList.toggle("hidden", isSpectator() || !state.round || Boolean(vote));
  if (vote) {
    const requester = state.players[vote.requesterSeat]?.name || "A player";
    const approved = vote.approvals.includes(state.you.seat);
    $("#restart-title").textContent = `${requester} wants a fresh deal`;
    $("#restart-note").textContent = approved
      ? `You accepted · ${vote.approvals.length}/4 players accepted`
      : `Starts a new deal. Room score stays ${state.score[0]}–${state.score[1]}. ${vote.approvals.length}/4 accepted.`;
    $("#accept-restart").classList.toggle("hidden", approved);
    $("#decline-restart").textContent = vote.requesterSeat === state.you.seat ? "Cancel request" : "Decline";
  }
}

function renderHostTransfer() {
  const block = $("#host-transfer-block");
  const select = $("#transfer-host-select");
  if (!block || !select) return;
  const host = !isSpectator() && state.you.seat === state.hostSeat;
  const humans = state.players
    .map((player, seat) => ({ player, seat }))
    .filter(({ player, seat }) => player && !player.bot && seat !== state.you.seat);
  block.classList.toggle("hidden", !host || !humans.length || Boolean(state.round));
  select.innerHTML = humans.map(({ player, seat }) =>
    `<option value="${seat}">${player.name} · Team ${player.team ? "B" : "A"}</option>`
  ).join("");
}

function renderTeamSwitchPanel() {
  const panel = $("#team-switch-panel");
  if (!panel) return;
  const request = state.teamSwitchRequest;
  const forMe = !isSpectator() && request && request.toSeat === state.you.seat;
  panel.classList.toggle("hidden", !forMe);
  if (!forMe) return;
  const from = state.players[request.fromSeat];
  $("#team-switch-title").textContent = `${from?.name || "A player"} wants to switch teams`;
  $("#team-switch-note").textContent = `They are on Team ${from?.team ? "B" : "A"}. Accept to swap seats.`;
}

function renderTimer() {
  const timer = $("#turn-timer");
  const deadline = state?.round?.turnDeadline;
  const active = state?.round?.phase === "playing" && deadline;
  timer.classList.toggle("hidden", !active);
  if (!active) return;
  const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  $("#timer-value").textContent = seconds;
  timer.classList.toggle("urgent", seconds <= 10);
}

function renderStatus() {
  let text = "Waiting for players";
  const round = state.round;
  if (round?.phase === "calling") {
    text = !isSpectator() && round.turn === state.you.seat ? "Your call" : `${state.players[round.turn]?.name || "Player"} is calling`;
  }
  if (round?.phase === "bidding") {
    const bidder = round.bidState?.turn === null ? null : state.players[round.bidState?.turn];
    text = round.bidState?.canBid || round.bidState?.canPass ? "Your bid" : `${bidder?.name || "Player"} is bidding`;
  }
  if (round?.phase === "auction_decision") {
    const decider = state.players[round.bidState?.decisionSeat];
    const bidder = state.players[round.bidState?.highestBidder];
    text = round.bidState?.canDecide
      ? "Your call: keep or give hukum"
      : `${decider?.name || "Original caller"} decides on ${bidder?.name || "the highest bidder"}'s bid`;
  }
  if (round?.phase === "choosing_trump") text = !isSpectator() && round.caller === state.you.seat ? "Choose the hukum" : `${state.players[round.caller].name} is choosing hukum`;
  if (round?.phase === "playing") text = !isSpectator() && round.turn === state.you.seat
    ? "Your turn"
    : `${state.players[round.turn].name}'s turn`;
  if (round?.phase === "trick_complete") text = `${state.players[round.pendingWinner].name} won the trick`;
  if (round?.phase === "round_over") text = "Round complete";
  $("#status").textContent = text;
}

function hukumSummary() {
  const round = state?.round;
  if (!round || state.gameType !== "court-piece") {
    return { eyebrow: "HUKUM", title: "No call yet", detail: "Start the deal to choose", history: [] };
  }
  const bid = round.bidState;
  const caller = state.players[round.caller]?.name || "Caller";
  const suit = round.trump ? symbols[round.trump] : round.mode === "hidden" ? "Hidden" : "Choosing";
  const contractBid = bid?.contractBid ?? bid?.highestBid;
  const contractSeat = bid?.contractBid !== null && bid?.contractBid !== undefined
    ? (bid.decision === "keep" ? round.caller : bid.highestBidder)
    : bid?.highestBidder;
  const contractPlayer = contractSeat === null || contractSeat === undefined ? caller : state.players[contractSeat]?.name || caller;
  const team = contractSeat === null || contractSeat === undefined
    ? state.players[round.caller]?.team
    : state.players[contractSeat]?.team;
  const history = bid?.history?.map((entry) => {
    const player = state.players[entry.seat];
    const action = entry.action === "pass"
      ? "Passed"
      : entry.action === "give"
        ? "Gave contract"
        : entry.action === "keep"
          ? `Kept ${entry.bid}`
          : entry.action === "forced_bid"
            ? `Opened ${entry.bid}`
            : `Bid ${entry.bid}`;
    return { player: player?.name || `Seat ${entry.seat + 1}`, team: player?.team || 0, action };
  }) || (round.passedBy || []).map((seat) => ({ player: state.players[seat]?.name || `Seat ${seat + 1}`, team: state.players[seat]?.team || 0, action: "Passed Hukum" }));

  if (round.phase === "bidding") {
    const leader = bid?.highestBidder === null ? "No bid yet" : `${state.players[bid.highestBidder]?.name || "Player"} · ${bid.highestBid}`;
    return { eyebrow: "AUCTION LIVE", title: leader, detail: `Team ${bid?.highestBidder === null ? "—" : state.players[bid.highestBidder]?.team ? "B" : "A"} leads`, history };
  }
  if (round.phase === "auction_decision") {
    return { eyebrow: "CONTRACT DECISION", title: `${contractPlayer} · ${contractBid}`, detail: `${caller} decides who keeps Hukum`, history };
  }
  if (contractBid !== null && contractBid !== undefined) {
    return { eyebrow: `TEAM ${team ? "B" : "A"} CONTRACT`, title: `${contractPlayer} called ${contractBid}`, detail: `Hukum ${suit} · ${caller} opened`, history };
  }
  return { eyebrow: "HUKUM CALL", title: `${caller} · ${suit}`, detail: (round.passedBy || []).length ? `${round.passedBy.length} passed before the call` : "Normal Hukum · no contract bid", history };
}

function renderPremiumHud() {
  const summary = hukumSummary();
  const round = state.round;
  $("#hud-score-a").textContent = state.score[0];
  $("#hud-score-b").textContent = state.score[1];
  $("#hud-hands-a").textContent = `${round?.tricks?.[0] || 0} hands`;
  $("#hud-hands-b").textContent = `${round?.tricks?.[1] || 0} hands`;
  $("#score-a-hands").textContent = `${round?.tricks?.[0] || 0} hands`;
  $("#score-b-hands").textContent = `${round?.tricks?.[1] || 0} hands`;
  $("#hud-status").textContent = $("#status").textContent;
  $("#hud-contract").innerHTML = `<span>${summary.eyebrow}</span><strong>${summary.title}</strong><small>${summary.detail}</small>`;
  const history = $("#hud-bid-history");
  history.innerHTML = summary.history.length
    ? summary.history.map((entry) => `<li><span>${entry.player}<small>Team ${entry.team ? "B" : "A"}</small></span><strong>${entry.action}</strong></li>`).join("")
    : "<li class=\"is-empty\">No Hukum passes or bids yet</li>";

  const story = $("#hukum-story");
  const hukumJustChosen = Boolean(
    round
    && state.gameType === "court-piece"
    && round.trump
    && (!previousState?.round?.trump || previousState.round.phase === "choosing_trump")
  );
  if (hukumJustChosen) {
    clearTimeout(hukumStoryTimer);
    story.innerHTML = `<span>${summary.eyebrow}</span><strong>${summary.title}</strong><small>${summary.detail}</small>`;
    story.classList.remove("hidden");
    hukumStoryTimer = setTimeout(() => {
      story.classList.add("hidden");
      hukumStoryTimer = null;
    }, 2200);
  } else if (!hukumStoryTimer) {
    story.classList.add("hidden");
  }
}

function compactHukumLabel(round) {
  if (!round?.trump) return "";
  const bid = round.bidState?.contractBid;
  const callerSeat = bid !== null && bid !== undefined && round.bidState?.decision === "give"
    ? round.bidState.highestBidder
    : round.caller;
  const caller = state.players[callerSeat]?.name || "Caller";
  const contract = bid !== null && bid !== undefined ? ` · ${bid} hands` : "";
  return `Hukum ${caller}${contract} · ${symbols[round.trump]}`;
}

function viewerTeam() {
  return state.players[perspectiveSeat()]?.team;
}

function isLocalTeam(team) {
  return team === viewerTeam();
}

function visibleWinningPlay(plays, trump) {
  if (!plays.length) return null;
  const leadSuit = plays[0].card.suit;
  return plays.reduce((winner, play) => {
    const score = (candidate) => {
      if (trump && candidate.card.suit === trump) return 200 + candidate.card.value;
      if (candidate.card.suit === leadSuit) return 100 + candidate.card.value;
      return candidate.card.value;
    };
    return score(play) > score(winner) ? play : winner;
  });
}

function runGameEffects() {
  const effects = initializeEffects();
  if (!previousState?.round || !state?.round) {
    if (state?.round && !previousState?.round) resetEffectStreaks(false);
    return;
  }

  if (state.round.dealer !== previousState.round.dealer) resetEffectStreaks(false);
  if (previousState.matchWinner !== null && state.matchWinner === null) resetEffectStreaks();

  const previousTrick = previousState.round.trick || [];
  const previousCards = new Set(previousTrick.map((play) => play.card.id));
  const newlyPlayed = (state.round.trick || []).find((play) => !previousCards.has(play.card.id));
  if (newlyPlayed) {
    const card = document.querySelector(`.played-card[data-card="${newlyPlayed.card.id}"]`);
    if (card && window.gsap) {
      try {
        if (isAtelierTheme() && !reducedMotionEnabled()) {
          const source = $("#seat-" + relativeSeat(newlyPlayed.seat) + " .avatar");
          const sourceRect = source?.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          const x = sourceRect ? sourceRect.left + sourceRect.width / 2 - (cardRect.left + cardRect.width / 2) : 0;
          const y = sourceRect ? sourceRect.top + sourceRect.height / 2 - (cardRect.top + cardRect.height / 2) : 0;
          gsap.fromTo(card,
            { x, y, scale: 0.58, rotation: newlyPlayed.seat % 2 ? -22 : 22, rotationY: 58, filter: "brightness(1.35) saturate(1.2)" },
            { x: 0, y: 0, scale: 1, rotation: 0, rotationY: 0, filter: "brightness(1) saturate(1)", duration: 0.62, ease: "power3.out", clearProps: "x,y,rotation,rotationY,filter" }
          );
        } else {
          gsap.fromTo(card,
            { scale: 0.42, rotation: newlyPlayed.seat % 2 ? -18 : 18, filter: "brightness(1.75)" },
            { scale: 1, rotation: 0, filter: "brightness(1)", duration: 0.46, ease: "back.out(2)" }
          );
        }
      } catch (_) { /* Card play remains functional without motion. */ }
    }

    const team = state.players[newlyPlayed.seat]?.team;
    effects?.onCardPlay?.({ element: card, team, isLocal: isLocalTeam(team) });
    const leadSuit = state.round.trick[0]?.card.suit;
    const trump = state.round.trump;
    const winningPlay = visibleWinningPlay(state.round.trick, trump);
    const isTrumpCut = previousTrick.length > 0
      && Boolean(trump)
      && leadSuit !== trump
      && newlyPlayed.card.suit === trump
      && winningPlay?.card.id === newlyPlayed.card.id;
    if (isTrumpCut) {
      const cutAcePlay = previousTrick.find((play) => play.card.rank === "A"
        && play.card.suit === leadSuit
        && state.players[play.seat]?.team !== team);
      const aceCut = Boolean(cutAcePlay);
      const aceElement = cutAcePlay
        ? document.querySelector(`.played-card[data-card="${cutAcePlay.card.id}"]`)
        : null;
      const streak = effectStreaks.trick.team === team ? Math.max(1, effectStreaks.trick.count) : 1;
      effects?.onTrumpCut?.({ aceCut, aceElement, element: card, team, isLocal: isLocalTeam(team), streak });
    }
  }

  const trickJustResolved = state.round.phase === "trick_complete" && previousState.round.phase !== "trick_complete";
  if (trickJustResolved) animateAtelierTrickCapture(state.round.pendingWinner);

  const winnerSeat = state.round.collectedBySeat?.findIndex((count, seat) => count > (previousState.round.collectedBySeat?.[seat] || 0)) ?? -1;
  const roundJustFinished = previousState.round.phase !== "round_over" && state.round.phase === "round_over";
  if (roundJustFinished) {
    const team = state.round.winner;
    const streak = nextEffectStreak("round", team);
    const payload = { team, isLocal: isLocalTeam(team), streak, court: Boolean(state.round.court), element: $(".table") };
    const matchJustFinished = false;
    if (matchJustFinished) effects?.onMatchWin?.(payload);
    else effects?.onRoundWin?.(payload);
    if (winnerSeat >= 0) nextEffectStreak("trick", state.players[winnerSeat]?.team);
    return;
  }

  if (winnerSeat >= 0) {
    const team = state.players[winnerSeat]?.team;
    const streak = nextEffectStreak("trick", team);
    effects?.onTrickWin?.({
      team,
      isLocal: isLocalTeam(team),
      streak,
      element: $(`#seat-${relativeSeat(winnerSeat)}`)
    });
  }
}

function render() {
  applyTableTheme(state.tableTheme);
  const meta = gameMeta[normalizeGameType(state.gameType)];
  document.body.dataset.gameType = normalizeGameType(state.gameType);
  syncThemeRadios("table-theme", state.tableTheme, isSpectator() || Boolean(state.round) || state.you.seat !== state.hostSeat);
  home.classList.add("hidden");
  game.classList.remove("hidden");
  $("#copy-code").textContent = state.code;
  $("#game-name").textContent = meta.eyebrow;
  $("#score-a-label").textContent = meta.scoreA;
  $("#score-b-label").textContent = meta.scoreB;
  $("#score-a").textContent = state.score[0];
  $("#score-b").textContent = state.score[1];
  [0, 1].forEach((team) => {
    if (state.score[team] > (previousState?.score?.[team] || 0)) {
      const element = team ? $("#score-b") : $("#score-a");
      element.classList.remove("score-pop");
      requestAnimationFrame(() => element.classList.add("score-pop"));
    }
  });
  const trump = $("#trump-badge");
  trump.classList.toggle("hidden", !state.round?.trump);
  trump.textContent = compactHukumLabel(state.round);
  trump.classList.toggle("red", ["hearts", "diamonds"].includes(state.round?.trump));
  const dealScore = $("#deal-score");
  dealScore.classList.toggle("hidden", !state.round);
  if (state.round) {
    dealScore.innerHTML = state.gameType === "court-piece"
      ? `<span class="deal-kicker">Hands</span><span class="deal-team deal-team-a">A <b>${state.round.tricks[0]}</b></span><i></i><span class="deal-team deal-team-b"><b>${state.round.tricks[1]}</b> B</span>`
      : state.gameType === "judgment"
        ? `<span class="deal-kicker">Calls</span><strong>${state.round.calls?.join(" · ") || "—"}</strong>`
        : `<span class="deal-kicker">Rummy</span><span>Stock <b>${state.round.stockCount ?? "—"}</b></span><i></i><span>Discard <b>${state.round.discardTop?.rank || "—"}</b></span>`;
    dealScore.removeAttribute("title");
  }
  $("#center-deck").classList.toggle("hidden", !state.round);
  const spectatorBar = $("#spectator-bar");
  spectatorBar.classList.toggle("hidden", !isSpectator());
  if (isSpectator()) {
    $("#watch-player").innerHTML = state.players.map((player, seat) => player ? `<option value="${seat}" ${seat === state.you.watchingSeat ? "selected" : ""}>${player.name} · Team ${player.team ? "B" : "A"}</option>` : "").join("");
    $("#spectator-count").textContent = `${state.spectators.length} watching`;
  }
  renderSeats();
  renderTrick();
  renderHand();
  renderPanels();
  renderStatus();
  renderPremiumHud();
  renderTimer();
  runGameEffects();
}

socket.on("room_state", (nextState) => {
  previousState = state;
  state = nextState;
  applyTableTheme(state.tableTheme);
  render();
  requestAnimationFrame(() => window.scrollTo(0, 0));
});
socket.on("kicked", (payload = {}) => {
  returnToHome(payload.reason || "The host removed you from the table.");
});
socket.on("room_destroyed", (payload = {}) => {
  toast(payload.reason === "human_inactivity" ? "Room closed after 5 minutes of inactivity" : "Room closed — no human players left");
  socket.close();
  localStorage.removeItem("courtPieceSession");
  storedSession = null;
  state = null;
  previousState = null;
  game.classList.add("hidden");
  home.classList.remove("hidden");
  applyTableTheme(createTableTheme);
  history.replaceState(null, "", location.pathname);
});
window.addEventListener("resize", () => { if (state) renderHand(); });
setInterval(renderTimer, 250);
applyTableTheme(createTableTheme);
bindOptionalControls();
initializeEffects();
document.addEventListener("pointerdown", unlockEffectsAudio, true);
document.addEventListener("keydown", unlockEffectsAudio, true);

async function resumeSession() {
  const queryCode = new URLSearchParams(location.search).get("room")?.toUpperCase();
  if (storedSession?.token && (!queryCode || queryCode === storedSession.code)) {
    try {
      await socket.connect(storedSession.code);
      const result = await emit(storedSession.role === "spectator" ? "join_spectator" : "join_room", storedSession);
      saveSession(result, storedSession.name);
      return;
    } catch (_) {
      localStorage.removeItem("courtPieceSession");
      storedSession = null;
      socket.close();
    }
  }
  if (queryCode) {
    $("#room-code").value = queryCode;
    previewRoomAvailability();
  }
  if (storedSession?.name) $("#name").value = storedSession.name;
}

resumeSession();
