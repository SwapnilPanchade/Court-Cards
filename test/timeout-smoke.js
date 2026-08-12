const { io } = require("socket.io-client");
const assert = require("node:assert/strict");

const url = process.env.GAME_URL || "http://127.0.0.1:3101";
const clients = Array.from({ length: 4 }, () => io(url, { transports: ["websocket"] }));

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
  await Promise.all(clients.map((client) => waitFor(client, "connect")));
  const names = ["Swapnil", "Pradeep", "Ajit", "Ajay"];
  const room = await action(clients[0], "create_room", { name: names[0] });
  await Promise.all([1, 2, 3].map((seat) => action(clients[seat], "join_room", { code: room.code, name: names[seat] })));
  await action(clients[0], "start_game");
  const autoPlayed = waitFor(clients[0], "room_state", (state) => state.round?.handCounts[0] === 8, 3000);
  await action(clients[0], "choose_trump", { suit: "spades" });
  const state = await autoPlayed;
  assert.equal(state.round.handCounts[0], 8);
  assert.equal(state.round.trick.length, 1);
  console.log("PASS: expired turn automatically played one legal card without a reload.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => clients.forEach((client) => client.close()));
