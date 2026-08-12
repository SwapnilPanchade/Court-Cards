import assert from "node:assert/strict";

const BASE = process.env.GAME_URL || "http://127.0.0.1:8787";
const NAMES = ["Swapnil", "Pradeep", "Ajit", "Ajay"];

function wsUrl(code) {
  const url = new URL(BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/${code}`;
  return url.toString();
}

async function connect(code) {
  const ws = new WebSocket(wsUrl(code));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  let latestState = null;
  const pending = new Map();

  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.event === "room_state") latestState = data.payload;
    if (data.id !== undefined && pending.has(data.id)) {
      const request = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok) request.resolve(data);
      else request.reject(new Error(data.error || "Request failed"));
    }
  });

  return {
    state: () => latestState,
    emit(event, payload = {}) {
      const id = String(nextId++);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${event} timed out`));
        }, 10_000);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); }
        });
        ws.send(JSON.stringify({ id, event, payload }));
      });
    },
    close() { ws.close(); }
  };
}

async function waitFor(client, predicate, label, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = client.state();
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function legalCard(state) {
  const hand = state.round.hand;
  const leadSuit = state.round.trick[0]?.card.suit;
  return leadSuit ? hand.find((card) => card.suit === leadSuit) || hand[0] : hand[0];
}

const created = await fetch(`${BASE}/api/create`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: NAMES[0], gameType: "court-piece", tableTheme: "noir" })
}).then((response) => response.json());
if (!created.ok) throw new Error(created.error);

const clients = await Promise.all(NAMES.map(() => connect(created.code)));
try {
  await clients[0].emit("join_room", { code: created.code, token: created.token, name: NAMES[0] });
  for (let seat = 1; seat < 4; seat += 1) {
    await clients[seat].emit("join_room", { code: created.code, name: NAMES[seat] });
  }
  await waitFor(clients[0], (state) => state.players.every(Boolean), "four players");
  const cleanDay = await clients[0].emit("start_new_settlement_day");
  assert.equal(cleanDay.settlement.games.length, 0);
  await clients[0].emit("update_settings", { deckSize: 20 });
  await clients[0].emit("start_game");

  let state = await waitFor(clients[0], (next) => next.round?.phase === "choosing_trump", "hukum choice");
  await clients[state.round.caller].emit("choose_trump", { suit: "spades" });

  while (true) {
    state = await waitFor(clients[0], (next) => ["playing", "round_over"].includes(next.round?.phase), "playable turn", 30_000);
    if (state.round.phase === "round_over") break;
    const turn = state.round.turn;
    const trickLength = state.round.trick.length;
    const playerState = await waitFor(clients[turn], (next) => next.round?.phase === "playing" && next.round.turn === turn, `seat ${turn} turn`);
    await clients[turn].emit("play_card", { cardId: legalCard(playerState).id });
    await waitFor(clients[0], (next) => next.round?.phase !== "playing"
      || next.round.turn !== turn
      || next.round.trick.length !== trickLength, "turn advance");
  }

  const result = await clients[0].emit("get_settlement");
  const latest = result.settlement.games.find((game) => game.roomCode === created.code);
  assert.ok(latest, "completed human game was recorded");
  assert.equal(latest.stakePaise, 500);
  assert.equal(result.settlement.transfers.reduce((sum, item) => sum + item.amountPaise, 0), 1_000);
  await assert.rejects(() => clients[0].emit("start_new_settlement_day"), /both confirmations/);

  const firstTransfer = result.settlement.transfers[0];
  const payer = clients[NAMES.indexOf(firstTransfer.from)];
  const receiver = clients[NAMES.indexOf(firstTransfer.to)];
  const unrelated = clients[NAMES.findIndex((name) => name !== firstTransfer.from && name !== firstTransfer.to)];
  await assert.rejects(() => unrelated.emit("confirm_settlement", { ...firstTransfer, confirmed: true }), /payer or receiver/);

  let updated = await payer.emit("confirm_settlement", { ...firstTransfer, confirmed: true });
  let pending = updated.settlement.transfers.find((item) => item.from === firstTransfer.from && item.to === firstTransfer.to);
  assert.equal(pending.payerConfirmed, true);
  assert.equal(pending.receiverConfirmed, false);
  assert.equal(updated.settlement.completedPayments.length, 0);

  updated = await payer.emit("confirm_settlement", { ...firstTransfer, confirmed: false });
  pending = updated.settlement.transfers.find((item) => item.from === firstTransfer.from && item.to === firstTransfer.to);
  assert.equal(pending.payerConfirmed, false);

  await payer.emit("confirm_settlement", { ...firstTransfer, confirmed: true });
  updated = await receiver.emit("confirm_settlement", { ...firstTransfer, confirmed: true });
  const completed = updated.settlement.completedPayments.find((item) => item.from === firstTransfer.from
    && item.to === firstTransfer.to && item.amountPaise === firstTransfer.amountPaise);
  assert.ok(completed, "payment clears only after payer and receiver confirm");

  updated = await payer.emit("reset_settlement", { paymentId: completed.id });
  assert.equal(updated.settlement.completedPayments.some((item) => item.id === completed.id), false);
  assert.ok(updated.settlement.transfers.some((item) => item.from === firstTransfer.from
    && item.to === firstTransfer.to && item.amountPaise === firstTransfer.amountPaise), "reset restores the debt");

  let settlement = updated.settlement;
  while (settlement.transfers.length) {
    const transfer = settlement.transfers[0];
    const payerClient = clients[NAMES.indexOf(transfer.from)];
    const receiverClient = clients[NAMES.indexOf(transfer.to)];
    await payerClient.emit("confirm_settlement", { ...transfer, confirmed: true });
    settlement = (await receiverClient.emit("confirm_settlement", { ...transfer, confirmed: true })).settlement;
  }
  assert.ok(settlement.balances.every((balance) => balance.amountPaise === 0));
  console.log(`settlement-smoke ok ${created.code}: bilateral confirm, reset, and ₹5 tracking passed`);

  const nextDay = await clients[0].emit("start_new_settlement_day");
  assert.equal(nextDay.settlement.games.length, 0);
  assert.equal(nextDay.settlement.transfers.length, 0);
} finally {
  clients.forEach((client) => client.close());
}

process.exit(0);
