const assert = require("node:assert/strict");
const { io } = require("socket.io-client");

const url = process.env.GAME_URL || "http://127.0.0.1:3000";
const clients = Array.from({ length: 5 }, () => io(url, { transports: ["websocket"] }));
const states = Array(clients.length).fill(null);
clients.forEach((client, index) => client.on("room_state", (state) => { states[index] = state; }));

function waitFor(client, event, predicate = () => true, timeout = 4000) {
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

function waitForState(index, predicate, timeout = 4000) {
  if (states[index] && predicate(states[index])) return Promise.resolve(states[index]);
  return waitFor(clients[index], "room_state", predicate, timeout);
}

function action(client, event, payload = {}) {
  return new Promise((resolve, reject) => client.emit(event, payload, (result) => result?.ok ? resolve(result) : reject(new Error(result?.error))));
}

async function main() {
  await Promise.all(clients.map((client) => waitFor(client, "connect")));
  await assert.rejects(() => action(clients[4], "create_room", { name: "Rahul", tableTheme: "casino" }), /valid table theme/);

  const created = await action(clients[0], "create_room", { name: "Swapnil", tableTheme: "neon", auctionMode: true, avatarId: "jugaadu" });
  assert.equal(created.tableTheme, "neon");
  assert.equal(created.auctionMode, true);
  assert.equal(created.avatarId, "jugaadu");
  await waitForState(0, (state) => state.code === created.code && state.tableTheme === "neon" && state.players[0]?.avatarId === "jugaadu");

  const joined = await action(clients[1], "join_room", { code: created.code, name: "Pradeep", avatarId: "chai-champion" });
  assert.equal(joined.avatarId, "chai-champion");
  await action(clients[1], "choose_avatar", { avatarId: "filmy-villain" });
  await waitForState(0, (state) => state.players[1]?.avatarId === "filmy-villain");
  const moved = await action(clients[0], "choose_team", { team: "B" });
  assert.deepEqual(moved, { ok: true, seat: 3, team: 1 });
  await waitForState(0, (state) => state.you.seat === 3 && state.hostSeat === 3);

  await action(clients[2], "join_room", { code: created.code, name: "Ajit" });
  await action(clients[3], "join_room", { code: created.code, name: "Ajay" });
  await waitForState(0, (state) => state.players.filter(Boolean).length === 4);

  await action(clients[0], "start_game");
  await waitForState(0, (state) => state.round?.phase === "bidding" && state.round.bidState.turn === 0);

  await action(clients[2], "place_bid", { bid: 5 });
  await waitForState(0, (state) => state.round?.bidState.turn === 1);
  await action(clients[1], "place_bid", { bid: 6 });
  await waitForState(0, (state) => state.round?.bidState.turn === 2);
  await action(clients[3], "pass_bid");
  await waitForState(0, (state) => state.round?.bidState.turn === 3);
  await action(clients[0], "pass_bid");
  const decision = await waitForState(2, (state) => state.round?.phase === "auction_decision" && state.round.bidState.canDecide);
  assert.equal(decision.round.bidState.decisionSeat, 0);
  assert.equal(decision.round.bidState.highestBidder, 1);
  assert.equal(decision.round.bidState.contractBid, 6);
  assert.equal(decision.round.bidState.contractTeam, null);
  await assert.rejects(() => action(clients[0], "decide_auction", { decision: "give" }), /original hukum caller/i);
  await action(clients[2], "decide_auction", { decision: "give" });
  const auction = await waitForState(0, (state) => state.round?.phase === "choosing_trump" && state.round.caller === 1);
  assert.equal(auction.round.bidState.contractBid, 6);
  assert.equal(auction.round.bidState.contractTeam, 1);
  assert.equal(auction.round.bidState.decision, "give");

  await action(clients[1], "choose_trump", { suit: "hearts" });
  const playing = await waitForState(0, (state) => state.round?.phase === "playing");
  assert.equal(playing.round.trump, "hearts");

  const botRoom = await action(clients[4], "create_room", { name: "Saurabh", tableTheme: "comic", auctionMode: true });
  await waitForState(4, (state) => state.code === botRoom.code);
  await action(clients[4], "fill_bots");
  const movedBotHost = await action(clients[4], "choose_team", { team: "B" });
  assert.equal(movedBotHost.seat, 1);
  await action(clients[4], "fill_bots");
  await action(clients[4], "start_game");
  await waitForState(4, (state) => state.round?.phase === "bidding" && state.round.bidState.turn === 1, 6000);
  await action(clients[4], "place_bid", { bid: 9 });
  const botAuction = await waitForState(4, (state) => state.round?.phase === "choosing_trump" && state.round.bidState.actedSeats.length === 4, 8000);
  assert.equal(botAuction.players.filter((player) => player?.bot).length, 3);
  assert.equal(new Set(botAuction.players.filter((player) => player?.bot).map((player) => player.avatarId)).size, 3);
  assert.equal(botAuction.round.caller, 1);
  assert.equal(botAuction.round.bidState.decision, "give");
  assert.equal(botAuction.round.bidState.contractBid, 9);
  assert.equal(botAuction.round.bidState.contractTeam, 1);
  assert.equal(botAuction.round.bidState.passedSeats.includes(2), true);
  assert.equal(botAuction.round.bidState.passedSeats.includes(3), true);
  await action(clients[4], "choose_trump", { suit: "spades" });
  await waitForState(4, (state) => state.round?.phase === "playing");

  console.log(`PASS: ${created.code} gave a human high bidder the contract; ${botRoom.code} confirmed a bot opener auto-decides and continues into play.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => clients.forEach((client) => client.close()));
