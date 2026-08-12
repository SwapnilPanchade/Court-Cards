import { RoomDurableObject } from "./room-do.js";
import { SettlementLedgerDurableObject } from "./settlement-do.js";
import { makeRoomCode } from "./room-logic.js";

export { RoomDurableObject, SettlementLedgerDurableObject };

async function createRoom(request, env) {
  const body = await request.json().catch(() => ({}));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeRoomCode((max) => {
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      return array[0] % max;
    });
    const id = env.ROOM.idFromName(code);
    const stub = env.ROOM.get(id);
    const response = await stub.fetch("https://room/internal/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, code })
    });
    const data = await response.json();
    if (response.status === 409) continue;
    return Response.json(data, { status: response.status });
  }
  return Response.json({ ok: false, error: "Could not allocate a room code." }, { status: 503 });
}

async function roomInfo(code, env) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return Response.json({ ok: false, error: "Room not found." }, { status: 404 });
  const id = env.ROOM.idFromName(normalized);
  const stub = env.ROOM.get(id);
  return stub.fetch("https://room/internal/info");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/create" && request.method === "POST") {
      return createRoom(request, env);
    }

    if (url.pathname.startsWith("/api/room/") && request.method === "GET") {
      const code = url.pathname.slice("/api/room/".length);
      return roomInfo(code, env);
    }

    if (url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const code = url.pathname.slice("/ws/".length).trim().toUpperCase();
      if (!code) return new Response("Room required", { status: 400 });
      const id = env.ROOM.idFromName(code);
      const stub = env.ROOM.get(id);
      return stub.fetch(request);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
