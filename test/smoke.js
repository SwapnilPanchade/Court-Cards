const { io } = require("socket.io-client");
const assert = require("node:assert/strict");

const url = process.env.GAME_URL || "http://127.0.0.1:3000";
const clients = Array.from({ length: 4 }, () => io(url, { transports: ["websocket"] }));
const spectator = io(url, { transports: ["websocket"] });
const states = Array(4).fill(null);
clients.forEach((client, index) => client.on("room_state", (state) => { states[index] = state; }));

function waitFor(client, event, predicate = () => true, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off(event, handler); reject(new Error(`Timed out waiting for ${event}`)); }, timeout);
    const handler = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      client.off(event, handler);
      resolve(value);
    };
    client.on(event, handler);
  });
}

function action(client, event, payload = {}) {
  return new Promise((resolve, reject) => client.emit(event, payload, (result) => result?.ok ? resolve(result) : reject(new Error(result?.error))));
}

async function main() {
  await Promise.all([...clients, spectator].map((client) => waitFor(client, "connect")));
  const created = await action(clients[0], "create_room", { name: "Player 1" });
  await Promise.all([1, 2, 3].map((index) => action(clients[index], "join_room", { code: created.code, name: `Player ${index + 1}` })));
  await action(spectator, "join_spectator", { code: created.code, name: "Buddy" });
  await action(clients[0], "update_settings", { deckSize: 36, mode: "single" });

  const started = waitFor(clients[0], "room_state", (state) => state.round?.phase === "choosing_trump");
  const spectatorStarted = waitFor(spectator, "room_state", (next) => next.round?.phase === "choosing_trump");
  await action(clients[0], "start_game");
  let state = await started;
  let spectatorState = await spectatorStarted;
  assert.equal(state.players.filter(Boolean).length, 4);
  assert.equal(state.round.deckSize, 36);
  assert.equal(state.round.mode, "single");
  assert.equal(state.round.hand.length, 5);
  assert.equal(spectatorState.you.role, "spectator");
  assert.equal(spectatorState.round.hand.length, 5);

  const passed = waitFor(clients[0], "room_state", (next) => next.round?.caller === 1);
  await action(clients[0], "pass_trump");
  state = await passed;
  assert.deepEqual(state.round.passedBy, [0]);

  const watchingNext = waitFor(spectator, "room_state", (next) => next.you.watchingSeat === 1);
  await action(spectator, "watch_player", { seat: 1 });
  spectatorState = await watchingNext;
  assert.equal(spectatorState.round.hand.length, 5);

  const trumpChosen = waitFor(clients[0], "room_state", (next) => next.round?.phase === "playing");
  const spectatorPlayingPromise = waitFor(spectator, "room_state", (next) => next.round?.phase === "playing");
  await action(clients[1], "choose_trump", { suit: "hearts" });
  state = await trumpChosen;
  assert.equal(state.round.hand.length, 9);
  const spectatorPlaying = await spectatorPlayingPromise;
  assert.equal(spectatorPlaying.round.hand.length, 9);
  await assert.rejects(() => action(spectator, "play_card", { cardId: spectatorPlaying.round.hand[0].id }), /Spectators cannot/);

  while (state.round.phase !== "round_over") {
    if (state.round.phase === "trick_complete") {
      state = await waitFor(clients[0], "room_state", (next) => next.round?.phase !== "trick_complete", 3500);
      continue;
    }
    const seat = state.round.turn;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const playerState = states[seat];
    const leadSuit = state.round.trick[0]?.card.suit;
    const matching = playerState.round.hand.filter((card) => card.suit === leadSuit);
    const selected = matching[0] || playerState.round.hand[0];
    const previousCount = state.round.handCounts[seat];
    const changed = waitFor(clients[0], "room_state", (next) => next.round?.handCounts[seat] === previousCount - 1);
    await action(clients[seat], "play_card", { cardId: selected.id });
    state = await changed;
  }

  assert.equal(state.score[0] + state.score[1], 1);
  assert.equal(Math.max(...state.round.tricks), 5);

  await action(clients[2], "request_restart");
  await action(clients[0], "respond_restart", { accept: true });
  await action(clients[1], "respond_restart", { accept: true });
  const restarted = waitFor(clients[0], "room_state", (next) => next.restartVote === null && next.round?.phase === "choosing_trump" && next.score[0] + next.score[1] === 0);
  await action(clients[3], "respond_restart", { accept: true });
  state = await restarted;
  assert.deepEqual(state.score, [0, 0]);
  console.log(`PASS: four players joined ${created.code}, passed hukum, scored one complete deal, and unanimously restarted the match.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => [...clients, spectator].forEach((client) => client.close()));
