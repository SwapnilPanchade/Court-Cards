const socket = io();
const $ = (selector) => document.querySelector(selector);
const home = $("#home");
const game = $("#game");
const homeError = $("#home-error");
const gameError = $("#game-error");
const symbols = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" };
const suitOrder = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };
let state = null;
let previousState = null;
let storedSession = JSON.parse(localStorage.getItem("courtPieceSession") || "null");

function emit(event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (result) => result?.ok ? resolve(result) : reject(new Error(result?.error || "Request failed.")));
  });
}

function setError(element, error) {
  element.textContent = error?.message || "";
  if (error) setTimeout(() => { element.textContent = ""; }, 3000);
}

function saveSession(result, name) {
  storedSession = { code: result.code, token: result.token, name, role: result.role || "player" };
  localStorage.setItem("courtPieceSession", JSON.stringify(storedSession));
  history.replaceState(null, "", `?room=${result.code}`);
}

async function enterRoom(kind) {
  homeError.textContent = "";
  const name = $("#name").value.trim();
  try {
    const result = kind === "create"
      ? await emit("create_room", { name })
      : await emit(kind === "spectator" ? "join_spectator" : "join_room", { code: $("#room-code").value, name });
    saveSession(result, name);
  } catch (error) { setError(homeError, error); }
}

$("#create-button").addEventListener("click", () => enterRoom("create"));
$("#join-button").addEventListener("click", () => enterRoom("join"));
$("#spectate-button").addEventListener("click", () => enterRoom("spectator"));
$("#room-code").addEventListener("keydown", (event) => { if (event.key === "Enter") enterRoom("join"); });

$("#start-button").addEventListener("click", () => emit("start_game").catch((error) => setError(gameError, error)));
$("#next-button").addEventListener("click", () => emit(state.matchWinner === null ? "next_round" : "restart_match").catch((error) => setError(gameError, error)));
$("#pass-button").addEventListener("click", () => emit("pass_trump").catch((error) => setError(gameError, error)));
$("#reveal-button").addEventListener("click", () => emit("reveal_trump").catch((error) => setError(gameError, error)));
$("#restart-button").addEventListener("click", () => emit("request_restart").catch((error) => setError(gameError, error)));
$("#accept-restart").addEventListener("click", () => emit("respond_restart", { accept: true }).catch((error) => setError(gameError, error)));
$("#decline-restart").addEventListener("click", () => emit("respond_restart", { accept: false }).catch((error) => setError(gameError, error)));
$("#exit-button").addEventListener("click", async () => {
  if (!window.confirm("Exit this room? The game will continue for the other players.")) return;
  try { await emit("leave_room"); } catch (_) { /* leave locally even if connection dropped */ }
  localStorage.removeItem("courtPieceSession");
  storedSession = null;
  previousState = null;
  state = null;
  game.classList.add("hidden");
  home.classList.remove("hidden");
  $("#room-code").value = "";
  history.replaceState(null, "", location.pathname);
});
$("#copy-code").addEventListener("click", shareInvite);
$("#share-button").addEventListener("click", shareInvite);
$("#watch-player").addEventListener("change", (event) => emit("watch_player", { seat: event.target.value }).catch((error) => setError(gameError, error)));

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
  return `<button class="card ${red ? "red" : ""} ${options.playable ? "playable" : ""}" ${options.disabled ? "disabled" : ""} data-card="${card.id}" ${options.seat === undefined ? "" : `data-seat="${options.seat}"`} ${options.owner ? `data-owner="${options.owner}"` : ""}>
    <span>${card.rank}<br>${symbols[card.suit]}</span><span class="center-suit">${symbols[card.suit]}</span>
  </button>`;
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
  for (let absolute = 0; absolute < 4; absolute += 1) {
    const position = relativeSeat(absolute);
    const player = state.players[absolute];
    const element = $(`#seat-${position}`);
    const isTurn = state.round?.turn === absolute && state.round?.phase === "playing";
    const remaining = state.round?.handCounts[absolute] || 0;
    const captured = state.round?.capturedBySeat?.[absolute] || 0;
    const capturedChanged = captured > (previousState?.round?.capturedBySeat?.[absolute] || 0);
    const cardBacks = state.round && absolute !== perspectiveSeat() && remaining
      ? `<div class="seat-cards" aria-label="${remaining} cards remaining"><i></i><i></i><i></i><span>${remaining}</span></div>`
      : "";
    const pile = captured
      ? `<div class="captured-pile ${capturedChanged ? "new-capture" : ""}" title="${captured} captured trick${captured === 1 ? "" : "s"}"><i></i><i></i><span>${captured}</span></div>`
      : "";
    element.className = `seat seat-${["bottom", "left", "top", "right"][position]} ${isTurn ? "active" : ""} ${player && !player.connected ? "offline" : ""}`;
    element.innerHTML = player
      ? `${pile}<div class="avatar">${player.name[0].toUpperCase()}</div><div>${player.name}${!isSpectator() && absolute === state.you.seat ? " (you)" : isSpectator() && absolute === perspectiveSeat() ? " (watching)" : ""}</div><div class="team">Team ${player.team ? "B" : "A"}</div>${cardBacks}`
      : `<div class="avatar">+</div><div>Empty seat</div>`;
  }
}

function renderHand() {
  const hand = $("#hand");
  const round = state.round;
  const label = $("#hand-label");
  if (!round?.hand?.length) { hand.innerHTML = ""; label.classList.add("hidden"); return; }
  label.classList.remove("hidden");
  const owner = state.players[perspectiveSeat()]?.name || "Player";
  label.textContent = isSpectator()
    ? `${owner}'s ${round.phase === "choosing_trump" ? "first five cards" : `hand · ${round.hand.length} cards`}`
    : round.phase === "choosing_trump" ? "Your first five cards" : `Your hand · ${round.hand.length} cards`;
  const leadSuit = round.trick[0]?.card.suit;
  const hasLead = leadSuit && round.hand.some((card) => card.suit === leadSuit);
  const sorted = [...round.hand].sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit] || a.value - b.value);
  hand.innerHTML = sorted.map((card) => {
    const legal = round.phase !== "playing" || !leadSuit || card.suit === leadSuit || !hasLead;
    const hiddenChoice = !isSpectator() && round.phase === "choosing_trump" && round.mode === "hidden" && round.caller === state.you.seat;
    const playable = !isSpectator() && (hiddenChoice || (round.phase === "playing" && round.turn === state.you.seat && legal));
    return cardHtml(card, { playable, disabled: !playable });
  }).join("");
  const cardWidth = Math.min(Math.max(window.innerWidth * 0.18, 60), 82);
  const available = Math.min(window.innerWidth - 28, 760);
  const step = sorted.length > 1 ? Math.min(cardWidth, (available - cardWidth) / (sorted.length - 1)) : cardWidth;
  hand.style.setProperty("--hand-overlap", `${step - cardWidth}px`);
  hand.style.width = `${cardWidth + Math.max(0, sorted.length - 1) * step}px`;
  hand.querySelectorAll(".card").forEach((card, index) => { card.style.zIndex = index + 1; });
  hand.querySelectorAll("[data-card]").forEach((card) => card.addEventListener("click", () => {
    card.blur();
    requestAnimationFrame(() => window.scrollTo(0, 0));
    if (isSpectator()) return;
    if (round.phase === "choosing_trump" && round.mode === "hidden") emit("choose_hidden_trump", { cardId: card.dataset.card }).catch((error) => setError(gameError, error));
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

function renderPanels() {
  const lobby = $("#lobby-panel");
  const trump = $("#trump-panel");
  const result = $("#round-panel");
  lobby.classList.toggle("hidden", Boolean(state.round) || isSpectator());
  trump.classList.add("hidden");
  result.classList.add("hidden");

  if (!state.round && !isSpectator()) {
    const count = state.players.filter(Boolean).length;
    $("#start-button").classList.toggle("hidden", state.you.seat !== state.hostSeat);
    $("#start-button").disabled = count !== 4;
    $("#lobby-note").textContent = `${count}/4 players joined${state.you.seat === state.hostSeat ? " — you are the host" : ""}`;
    const host = state.you.seat === state.hostSeat;
    const deckSelect = $("#deck-size");
    deckSelect.innerHTML = state.options.deckSizes.map((size) => `<option value="${size}" ${size === state.settings.deckSize ? "selected" : ""}>${size} cards · ${size / 4} each</option>`).join("");
    $("#game-mode").value = state.settings.mode;
    deckSelect.disabled = !host;
    $("#game-mode").disabled = !host;
    const updateSettings = () => emit("update_settings", { deckSize: deckSelect.value, mode: $("#game-mode").value }).catch((error) => setError(gameError, error));
    deckSelect.onchange = updateSettings;
    $("#game-mode").onchange = updateSettings;
  } else if (!isSpectator() && state.round.phase === "choosing_trump" && state.round.caller === state.you.seat) {
    trump.classList.remove("hidden");
    const hidden = state.round.mode === "hidden";
    $("#trump-help").textContent = hidden ? "Tap one of your five cards. Its suit stays secret." : "Pick a suit after seeing your first five cards.";
    $("#suit-buttons").classList.toggle("hidden", hidden);
    if (!hidden) {
      $("#suit-buttons").innerHTML = state.suits.map((suit) => `<button class="suit-button ${(suit === "hearts" || suit === "diamonds") ? "red" : ""}" data-suit="${suit}" aria-label="${suit}">${symbols[suit]}</button>`).join("");
      $("#suit-buttons").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => emit("choose_trump", { suit: button.dataset.suit }).catch((error) => setError(gameError, error))));
    }
    $("#pass-button").classList.toggle("hidden", !state.round.canPass);
  } else if (state.round.phase === "round_over") {
    result.classList.remove("hidden");
    const won = !isSpectator() && state.round.winner === state.players[state.you.seat].team;
    const matchDone = state.matchWinner !== null;
    $("#round-result").innerHTML = `<strong>${matchDone ? `Team ${state.matchWinner ? "B" : "A"} wins the match!` : isSpectator() ? `Team ${state.round.winner ? "B" : "A"} wins the deal.` : won ? "Your team wins the deal." : "Other team wins the deal."}</strong><br>Tricks ${state.round.tricks[0]}–${state.round.tricks[1]} · Match ${state.score[0]}–${state.score[1]}`;
    $("#next-button").classList.toggle("hidden", isSpectator() || state.you.seat !== state.hostSeat);
    $("#next-button").textContent = matchDone ? "Start new match" : "Deal next round";
  }
  $("#reveal-button").classList.toggle("hidden", !state.round?.canRevealTrump);

  const restartPanel = $("#restart-panel");
  const vote = isSpectator() ? null : state.restartVote;
  restartPanel.classList.toggle("hidden", !vote);
  $("#restart-button").classList.toggle("hidden", isSpectator() || !state.round || Boolean(vote));
  if (vote) {
    const requester = state.players[vote.requesterSeat]?.name || "A player";
    const approved = vote.approvals.includes(state.you.seat);
    $("#restart-title").textContent = `${requester} wants a fresh match`;
    $("#restart-note").textContent = approved
      ? `You accepted · ${vote.approvals.length}/4 players accepted`
      : `Current score and deal will reset. ${vote.approvals.length}/4 accepted.`;
    $("#accept-restart").classList.toggle("hidden", approved);
    $("#decline-restart").textContent = vote.requesterSeat === state.you.seat ? "Cancel request" : "Decline";
  }
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
  if (round?.phase === "choosing_trump") text = !isSpectator() && round.caller === state.you.seat ? "Choose the hukum" : `${state.players[round.caller].name} is choosing hukum`;
  if (round?.phase === "playing") text = `${round.mode === "double" ? `Double Sir · ${round.pool} pooled · ` : round.mode === "hidden" ? `Hidden Sir · ${round.pool} pooled · ` : ""}${!isSpectator() && round.turn === state.you.seat ? "Your turn" : `${state.players[round.turn].name}'s turn`}`;
  if (round?.phase === "trick_complete") text = `${state.players[round.pendingWinner].name} won the trick`;
  if (round?.phase === "round_over") text = "Round complete";
  $("#status").textContent = text;
}

function render() {
  home.classList.add("hidden");
  game.classList.remove("hidden");
  $("#copy-code").textContent = state.code;
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
  trump.textContent = state.round?.trump ? `Hukum ${symbols[state.round.trump]}` : "";
  trump.classList.toggle("red", ["hearts", "diamonds"].includes(state.round?.trump));
  const dealScore = $("#deal-score");
  dealScore.classList.toggle("hidden", !state.round || state.round.phase === "choosing_trump");
  if (state.round) dealScore.textContent = `TRICKS  A ${state.round.tricks[0]}  ·  ${state.round.tricks[1]} B`;
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
  renderTimer();
}

socket.on("room_state", (nextState) => {
  previousState = state;
  state = nextState;
  render();
  requestAnimationFrame(() => window.scrollTo(0, 0));
});
window.addEventListener("resize", () => { if (state) renderHand(); });
setInterval(renderTimer, 250);
socket.on("connect", async () => {
  const queryCode = new URLSearchParams(location.search).get("room")?.toUpperCase();
  if (storedSession?.token && (!queryCode || queryCode === storedSession.code)) {
    try {
      const result = await emit(storedSession.role === "spectator" ? "join_spectator" : "join_room", storedSession);
      saveSession(result, storedSession.name);
      return;
    } catch (_) { localStorage.removeItem("courtPieceSession"); storedSession = null; }
  }
  if (queryCode) $("#room-code").value = queryCode;
  if (storedSession?.name) $("#name").value = storedSession.name;
});
