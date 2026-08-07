const BASE = process.env.GAME_URL || "http://127.0.0.1:8787";

function wsUrl(code) {
  const url = new URL(BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/${code}`;
  return url.toString();
}

async function connect(code) {
  const ws = new WebSocket(wsUrl(code));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  let nextId = 1;
  const pending = new Map();
  let latestState = null;
  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.event === "room_state") latestState = data.payload;
    if (data.id !== undefined && pending.has(data.id)) {
      const { resolve: done, reject: fail } = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok) done(data);
      else fail(new Error(data.error || "failed"));
    }
  });
  return {
    ws,
    state: () => latestState,
    async emit(event, payload = {}) {
      const id = String(nextId++);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, event, payload }));
        setTimeout(() => reject(new Error(`${event} timeout`)), 8000);
      });
    },
    close() { ws.close(); }
  };
}

async function waitFor(client, predicate, label) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (client.state() && predicate(client.state())) return client.state();
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

const created = await fetch(`${BASE}/api/create`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Host", avatarId: "sher", tableTheme: "noir" })
}).then((r) => r.json());
if (!created.ok) throw new Error(created.error);

const host = await connect(created.code);
await host.emit("join_room", { code: created.code, token: created.token, name: "Host" });
await waitFor(host, (s) => s.players[0]?.name === "Host", "host seated");
await host.emit("fill_bots");
await waitFor(host, (s) => s.players.every(Boolean), "bots filled");

const guest = await connect(created.code);
await guest.emit("join_room", {
  code: created.code,
  name: "Guest",
  avatarId: "jugaadu",
  replaceSeat: 1
});
await waitFor(guest, (s) => s.you.seat === 1 && !s.players[1].bot, "guest replaced bot");

await host.emit("transfer_host", { seat: 1 });
await waitFor(host, (s) => s.hostSeat === 1, "host transferred");

await guest.emit("request_team_switch", { targetSeat: 0 });
await waitFor(host, (s) => s.teamSwitchRequest?.toSeat === 0, "switch requested");
await host.emit("respond_team_switch", { accept: true });
await waitFor(guest, (s) => s.you.seat === 0, "seats swapped");

await guest.emit("start_game");
await waitFor(guest, (s) => s.round, "game started");

console.log("ws-smoke ok", created.code);
host.close();
guest.close();
