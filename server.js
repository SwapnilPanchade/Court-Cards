const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { SUITS, DECK_SIZES, MODES, createRound, chooseTrump, chooseHiddenTrump, passTrump, revealTrump, playCard, collectTrick, teamForSeat } = require("./game");

const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const TURN_TIMEOUT_MS = Math.max(100, Number(process.env.TURN_TIMEOUT_MS) || 40_000);
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_request, response) => response.json({ ok: true }));

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").replace(/[<>&"']/g, "").slice(0, 18);
}

function roomView(room, viewer) {
  const round = room.round;
  const isPlayer = viewer.role === "player";
  const viewerSeat = isPlayer ? viewer.seat : viewer.spectator.watchingSeat;
  const player = isPlayer ? room.players[viewerSeat] : null;
  const visibleHand = !round || viewerSeat === null || viewerSeat === undefined
    ? []
    : round.phase === "choosing_trump"
      ? round.hands[viewerSeat].slice(0, 5)
      : round.hands[viewerSeat];

  return {
    code: room.code,
    hostSeat: room.hostSeat,
    you: isPlayer
      ? { role: "player", seat: viewerSeat, token: player.token }
      : { role: "spectator", token: viewer.spectator.token, name: viewer.spectator.name, watchingSeat: viewerSeat },
    players: room.players.map((item, seat) =>
      item ? { seat, name: item.name, connected: Boolean(item.socketId), team: teamForSeat(seat) } : null
    ),
    score: room.score,
    matchTarget: room.matchTarget,
    matchWinner: room.matchWinner,
    restartVote: room.restartVote,
    spectators: room.spectators.map((spectator) => ({ name: spectator.name, watchingSeat: spectator.watchingSeat })),
    round: round && {
      phase: round.phase,
      dealer: round.dealer,
      caller: round.caller,
      passedBy: round.passedBy,
      canPass: isPlayer && round.phase === "choosing_trump" && round.caller === viewerSeat && round.passedBy.length < 3,
      mode: round.mode,
      deckSize: round.deckSize,
      trump: round.trumpRevealed || (isPlayer && round.caller === viewerSeat) ? round.trump : null,
      trumpRevealed: round.trumpRevealed,
      canRevealTrump: isPlayer && round.mode === "hidden" && !round.trumpRevealed && round.turn === viewerSeat && (viewerSeat === round.caller && !round.trick.length || (round.trick.length && !round.hands[viewerSeat].some((card) => card.suit === round.trick[0].card.suit))),
      turn: round.turn,
      turnDeadline: round.turnDeadline || null,
      pendingWinner: round.pendingWinner,
      trick: round.trick,
      tricks: round.tricks,
      capturedBySeat: round.capturedBySeat,
      pool: round.pool,
      winner: round.winner,
      court: round.court,
      hand: visibleHand,
      handCounts: round.hands.map((hand) => hand.length)
    },
    suits: SUITS,
    settings: room.settings,
    options: { deckSizes: DECK_SIZES, modes: MODES }
  };
}

function sendRoom(room) {
  room.players.forEach((player, seat) => {
    if (player?.socketId) io.to(player.socketId).emit("room_state", roomView(room, { role: "player", seat }));
  });
  room.spectators.forEach((spectator) => {
    if (spectator.socketId) io.to(spectator.socketId).emit("room_state", roomView(room, { role: "spectator", spectator }));
  });
}

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  if (room.round) room.round.turnDeadline = null;
}

function finishCompletedTrick(room, round) {
  if (room.round !== round || round.phase !== "trick_complete") return;
  collectTrick(round);
  if (round.phase === "round_over") {
    room.score[round.winner] += 1;
    if (room.score[round.winner] >= room.matchTarget) room.matchWinner = round.winner;
  }
  room.updatedAt = Date.now();
  scheduleTurn(room);
  sendRoom(room);
}

function scheduleCollection(room, round) {
  clearTurnTimer(room);
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    finishCompletedTrick(room, round);
  }, 1600);
}

function scheduleTurn(room) {
  clearTurnTimer(room);
  const round = room.round;
  if (!round || round.phase !== "playing" || round.turn === null) return;
  const expectedSeat = round.turn;
  round.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    if (room.round !== round || round.phase !== "playing" || round.turn !== expectedSeat) return;
    const hand = round.hands[expectedSeat];
    const leadSuit = round.trick[0]?.card.suit;
    let legal = leadSuit ? hand.filter((card) => card.suit === leadSuit) : hand;
    if (!legal.length) legal = hand;
    if (round.mustTrumpSeat === expectedSeat) {
      const trumps = hand.filter((card) => card.suit === round.trump);
      if (trumps.length) legal = trumps;
    }
    const selected = legal[crypto.randomInt(legal.length)];
    playCard(round, expectedSeat, selected.id);
    room.updatedAt = Date.now();
    if (round.phase === "trick_complete") scheduleCollection(room, round);
    else scheduleTurn(room);
    sendRoom(room);
  }, TURN_TIMEOUT_MS);
}

function leaveCurrentSocket(socket) {
  const code = socket.data.roomCode;
  const room = rooms.get(code);
  if (!room) return;
  if (socket.data.role === "spectator") {
    const spectator = room.spectators.find((item) => item.token === socket.data.spectatorToken);
    if (spectator?.socketId === socket.id) spectator.socketId = null;
    sendRoom(room);
    return;
  }
  const seat = socket.data.seat;
  if (room.players[seat]?.socketId === socket.id) room.players[seat].socketId = null;
  sendRoom(room);
}

function playerSeat(socket) {
  if (socket.data.role !== "player" || !Number.isInteger(socket.data.seat)) throw new Error("Spectators cannot perform game actions.");
  return socket.data.seat;
}

function ackError(ack, error) {
  if (typeof ack === "function") ack({ ok: false, error: error.message || "Something went wrong." });
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ name } = {}, ack) => {
    try {
      const playerName = cleanName(name);
      if (!playerName) throw new Error("Enter your name.");
      leaveCurrentSocket(socket);
      const code = makeRoomCode();
      const token = crypto.randomUUID();
      const room = {
        code,
        players: [{ name: playerName, token, socketId: socket.id }, null, null, null],
        spectators: [],
        hostSeat: 0,
        dealer: 3,
        round: null,
        score: [0, 0],
        matchTarget: 4,
        matchWinner: null,
        restartVote: null,
        turnTimer: null,
        settings: { deckSize: 36, mode: "single" },
        updatedAt: Date.now()
      };
      rooms.set(code, room);
      socket.data = { roomCode: code, role: "player", seat: 0 };
      socket.join(code);
      ack({ ok: true, code, token });
      sendRoom(room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("join_room", ({ code, name, token } = {}, ack) => {
    try {
      const normalizedCode = String(code || "").trim().toUpperCase();
      const room = rooms.get(normalizedCode);
      if (!room) throw new Error("Room not found. Check the code.");
      leaveCurrentSocket(socket);

      let seat = token ? room.players.findIndex((item) => item?.token === token) : -1;
      if (seat < 0) {
        if (room.round) throw new Error("This game has already started.");
        seat = room.players.findIndex((item) => !item);
        if (seat < 0) throw new Error("This room is full.");
        const playerName = cleanName(name);
        if (!playerName) throw new Error("Enter your name.");
        token = crypto.randomUUID();
        room.players[seat] = { name: playerName, token, socketId: socket.id };
      } else {
        room.players[seat].socketId = socket.id;
      }

      socket.data = { roomCode: normalizedCode, role: "player", seat };
      socket.join(normalizedCode);
      room.updatedAt = Date.now();
      ack({ ok: true, code: normalizedCode, token, seat });
      sendRoom(room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("join_spectator", ({ code, name, token } = {}, ack) => {
    try {
      const normalizedCode = String(code || "").trim().toUpperCase();
      const room = rooms.get(normalizedCode);
      if (!room) throw new Error("Room not found. Check the code.");
      leaveCurrentSocket(socket);
      let spectator = token ? room.spectators.find((item) => item.token === token) : null;
      if (!spectator) {
        const spectatorName = cleanName(name);
        if (!spectatorName) throw new Error("Enter your name.");
        if (room.spectators.length >= 20) throw new Error("Spectator seats are full.");
        spectator = { name: spectatorName, token: crypto.randomUUID(), socketId: socket.id, watchingSeat: 0 };
        room.spectators.push(spectator);
      } else spectator.socketId = socket.id;
      socket.data = { roomCode: normalizedCode, role: "spectator", spectatorToken: spectator.token };
      socket.join(normalizedCode);
      room.updatedAt = Date.now();
      ack({ ok: true, code: normalizedCode, token: spectator.token, role: "spectator" });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("watch_player", ({ seat } = {}, ack) => {
    try {
      if (socket.data.role !== "spectator") throw new Error("Only spectators choose a player to follow.");
      const room = rooms.get(socket.data.roomCode);
      const numericSeat = Number(seat);
      if (!room?.players[numericSeat]) throw new Error("Choose an active player.");
      const spectator = room.spectators.find((item) => item.token === socket.data.spectatorToken);
      if (!spectator) throw new Error("Spectator session not found.");
      spectator.watchingSeat = numericSeat;
      ack({ ok: true });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("start_game", (_payload, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error("Join a room first.");
      if (seat !== room.hostSeat) throw new Error("Only the host can start.");
      if (room.players.some((player) => !player)) throw new Error("Four players are required.");
      if (room.round && room.round.phase !== "round_over") throw new Error("A round is already active.");
      room.round = createRound(room.dealer, room.settings);
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("update_settings", ({ deckSize, mode } = {}, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error("Join a room first.");
      if (seat !== room.hostSeat) throw new Error("Only the host can change settings.");
      if (room.round) throw new Error("Settings cannot change after the game starts.");
      const numericSize = Number(deckSize);
      if (!DECK_SIZES.includes(numericSize) || !MODES.includes(mode)) throw new Error("Choose valid game settings.");
      room.settings = { deckSize: numericSize, mode };
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("choose_trump", ({ suit } = {}, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round) throw new Error("No active round.");
      if (room.round.mode === "hidden") throw new Error("Choose a card for hidden hukum.");
      chooseTrump(room.round, seat, suit);
      room.updatedAt = Date.now();
      scheduleTurn(room);
      ack({ ok: true });
      sendRoom(room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("pass_trump", (_payload, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round) throw new Error("No active round.");
      passTrump(room.round, seat);
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("choose_hidden_trump", ({ cardId } = {}, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round) throw new Error("No active round.");
      chooseHiddenTrump(room.round, seat, cardId);
      room.updatedAt = Date.now();
      scheduleTurn(room);
      ack({ ok: true });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("reveal_trump", (_payload, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round) throw new Error("No active round.");
      revealTrump(room.round, seat);
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("play_card", ({ cardId } = {}, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round) throw new Error("No active round.");
      playCard(room.round, seat, cardId);
      room.updatedAt = Date.now();
      if (room.round.phase === "trick_complete") {
        const round = room.round;
        scheduleCollection(room, round);
      } else scheduleTurn(room);
      ack({ ok: true });
      sendRoom(room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("next_round", (_payload, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round || room.round.phase !== "round_over") throw new Error("Finish the current round first.");
      if (seat !== room.hostSeat) throw new Error("Only the host can start the next round.");
      if (room.matchWinner !== null) throw new Error("Match is complete. Start a new match.");
      room.dealer = (room.dealer + 1) % 4;
      room.round = createRound(room.dealer, room.settings);
      room.restartVote = null;
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("restart_match", (_payload, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.matchWinner === null) throw new Error("The match is not complete.");
      if (seat !== room.hostSeat) throw new Error("Only the host can restart the match.");
      room.score = [0, 0];
      room.matchWinner = null;
      room.dealer = (room.dealer + 1) % 4;
      room.round = createRound(room.dealer, room.settings);
      room.restartVote = null;
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("request_restart", (_payload, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round) throw new Error("Start a game first.");
      if (room.restartVote) throw new Error("A restart vote is already active.");
      room.restartVote = { requesterSeat: seat, approvals: [seat] };
      ack({ ok: true });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("respond_restart", ({ accept } = {}, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.restartVote) throw new Error("No restart vote is active.");
      if (!accept) {
        room.restartVote = null;
        ack({ ok: true });
        sendRoom(room);
        return;
      }
      if (!room.restartVote.approvals.includes(seat)) room.restartVote.approvals.push(seat);
      if (room.restartVote.approvals.length === 4) {
        clearTurnTimer(room);
        room.score = [0, 0];
        room.matchWinner = null;
        room.restartVote = null;
        room.dealer = (room.dealer + 1) % 4;
        room.round = createRound(room.dealer, room.settings);
      }
      ack({ ok: true });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("leave_room", (_payload, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (room) {
      if (socket.data.role === "spectator") {
        room.spectators = room.spectators.filter((item) => item.token !== socket.data.spectatorToken);
      } else {
        const seat = socket.data.seat;
        if (room.players[seat]?.socketId === socket.id) room.players[seat].socketId = null;
      }
      socket.leave(room.code);
      socket.data = {};
      sendRoom(room);
    }
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("disconnect", () => leaveCurrentSocket(socket));
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.updatedAt < cutoff && room.players.every((player) => !player?.socketId) && room.spectators.every((spectator) => !spectator.socketId)) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, () => console.log(`Court Piece running at http://localhost:${PORT}`));
