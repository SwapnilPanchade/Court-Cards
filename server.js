const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { SUITS, DECK_SIZES, MODES, createRound, placeBid, passBid, decideAuction, chooseTrump, chooseHiddenTrump, passTrump, revealTrump, playCard, collectTrick, teamForSeat } = require("./game");

const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 28080;
const TURN_TIMEOUT_MS = Math.max(100, Number(process.env.TURN_TIMEOUT_MS) || 40_000);
const MATCH_TARGET = Math.max(1, Number(process.env.MATCH_TARGET) || 4);
const DEFAULT_DECK_SIZE = DECK_SIZES.includes(Number(process.env.DEFAULT_DECK_SIZE)) ? Number(process.env.DEFAULT_DECK_SIZE) : 36;
const DEFAULT_MODE = MODES.includes(process.env.DEFAULT_MODE) ? process.env.DEFAULT_MODE : "single";
const BOT_ACTION_DELAY_MS = Math.max(100, Number(process.env.BOT_ACTION_DELAY_MS) || 650);
const rooms = new Map();
const TABLE_THEMES = ["noir", "comic", "neon", "adda", "gully"];
const DEFAULT_TABLE_THEME = "noir";
const AVATAR_IDS = Object.freeze([
  "kadki-king",
  "chai-champion",
  "jugaadu",
  "sher",
  "filmy-villain",
  "office-babu",
  "cool-aunty",
  "biker-didi",
  "glam-queen",
  "bollywood-boss"
]);
const DEFAULT_AVATAR_ID = AVATAR_IDS[0];

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

function normalizeAvatarId(value, fallback = DEFAULT_AVATAR_ID) {
  const avatarId = value === undefined || value === null || value === ""
    ? fallback
    : String(value).trim().toLowerCase();
  if (!AVATAR_IDS.includes(avatarId)) throw new Error("Choose a valid avatar.");
  return avatarId;
}

function defaultAvatarForSeat(seat) {
  return AVATAR_IDS[Math.abs(Number(seat) || 0) % AVATAR_IDS.length];
}

function makeBot(seat) {
  const titles = ["Ace", "Queen", "King", "Jack"];
  return {
    name: `${titles[seat]} Bot`,
    token: `bot-${crypto.randomUUID()}`,
    socketId: null,
    bot: true,
    avatarId: defaultAvatarForSeat(seat)
  };
}

function isBot(room, seat) {
  return Boolean(room.players[seat]?.bot);
}

function normalizeTeam(value) {
  const normalized = String(value).toUpperCase();
  if (value === 0 || normalized === "0" || normalized === "A") return 0;
  if (value === 1 || normalized === "1" || normalized === "B") return 1;
  throw new Error("Choose Team A or Team B.");
}

function updateRoomSettings(room, seat, updates = {}) {
  if (seat !== room.hostSeat) throw new Error("Only the host can change settings.");
  if (room.round) throw new Error("Settings cannot change after the game starts.");

  const deckSize = updates.deckSize === undefined ? room.settings.deckSize : Number(updates.deckSize);
  const mode = updates.mode === undefined ? room.settings.mode : updates.mode;
  const auctionMode = updates.auctionMode === undefined ? Boolean(room.settings.auctionMode) : updates.auctionMode;
  const tableTheme = updates.tableTheme === undefined ? (room.tableTheme || DEFAULT_TABLE_THEME) : updates.tableTheme;

  if (!DECK_SIZES.includes(deckSize) || !MODES.includes(mode)) throw new Error("Choose valid game settings.");
  if (typeof auctionMode !== "boolean") throw new Error("Auction mode must be on or off.");
  if (!TABLE_THEMES.includes(tableTheme)) throw new Error("Choose a valid table theme.");

  room.settings = { deckSize, mode, auctionMode };
  room.tableTheme = tableTheme;
  return room;
}

function chooseRoomTeam(room, seat, requestedTeam) {
  if (room.round) throw new Error("Teams cannot change after the game starts.");
  const player = room.players[seat];
  if (!player || player.bot) throw new Error("Only a seated player can choose a team.");
  const team = normalizeTeam(requestedTeam);
  if (teamForSeat(seat) === team) return seat;

  const teamSeats = [0, 1, 2, 3].filter((candidate) => teamForSeat(candidate) === team);
  const targetSeat = teamSeats.find((candidate) => !room.players[candidate])
    ?? teamSeats.find((candidate) => room.players[candidate]?.bot);
  if (targetSeat === undefined) throw new Error(`Team ${team ? "B" : "A"} is full.`);

  room.players[seat] = null;
  room.players[targetSeat] = player;
  if (room.hostSeat === seat) room.hostSeat = targetSeat;
  return targetSeat;
}

function chooseRoomAvatar(room, seat, requestedAvatarId) {
  if (room.round) throw new Error("Avatars cannot change after the game starts.");
  const player = room.players[seat];
  if (!player || player.bot) throw new Error("Only a seated player can choose an avatar.");
  player.avatarId = normalizeAvatarId(requestedAvatarId);
  return player.avatarId;
}

function recordRoundResult(room, round) {
  if (!round || (round.winner !== 0 && round.winner !== 1)) throw new Error("Round winner is not resolved.");
  if (round.resultRecorded) return room.matchWinner;
  round.resultRecorded = true;
  room.score[round.winner] += 1;
  if (room.score[round.winner] >= room.matchTarget) room.matchWinner = round.winner;
  return room.matchWinner;
}

function assertMatchOpen(room) {
  if (room.matchWinner !== null) throw new Error("Match is complete. Start a new match.");
}

function roomView(room, viewer) {
  const round = room.round;
  const isPlayer = viewer.role === "player";
  const viewerSeat = isPlayer ? viewer.seat : viewer.spectator.watchingSeat;
  const player = isPlayer ? room.players[viewerSeat] : null;
  const visibleHand = !round || viewerSeat === null || viewerSeat === undefined
    ? []
    : round.phase === "choosing_trump" || round.phase === "bidding" || round.phase === "auction_decision"
      ? round.hands[viewerSeat].slice(0, 5)
      : round.hands[viewerSeat];

  return {
    code: room.code,
    hostSeat: room.hostSeat,
    you: isPlayer
      ? { role: "player", seat: viewerSeat, token: player.token }
      : { role: "spectator", token: viewer.spectator.token, name: viewer.spectator.name, watchingSeat: viewerSeat },
    players: room.players.map((item, seat) =>
      item ? {
        seat,
        name: item.name,
        avatarId: item.avatarId || defaultAvatarForSeat(seat),
        connected: Boolean(item.socketId) || Boolean(item.bot),
        bot: Boolean(item.bot),
        team: teamForSeat(seat)
      } : null
    ),
    score: room.score,
    matchTarget: room.matchTarget,
    matchWinner: room.matchWinner,
    tableTheme: room.tableTheme,
    restartVote: room.restartVote,
    spectators: room.spectators.map((spectator) => ({ name: spectator.name, watchingSeat: spectator.watchingSeat })),
    round: round && {
      phase: round.phase,
      dealer: round.dealer,
      caller: round.caller,
      passedBy: round.passedBy,
      canPass: isPlayer && !round.auctionMode && round.phase === "choosing_trump" && round.caller === viewerSeat && round.passedBy.length < 3,
      mode: round.mode,
      deckSize: round.deckSize,
      auctionMode: round.auctionMode,
      bidState: round.bidState && {
        openingSeat: round.bidState.openingSeat,
        minimumBid: round.bidState.minimumBid,
        maximumBid: round.bidState.maximumBid,
        highestBid: round.bidState.highestBid,
        highestBidder: round.bidState.highestBidder,
        turn: round.bidState.turn,
        actedSeats: round.bidState.actedSeats,
        passedSeats: round.bidState.passedSeats,
        history: round.bidState.history,
        complete: round.bidState.complete,
        decisionSeat: round.bidState.decisionSeat,
        decision: round.bidState.decision,
        decisionReason: round.bidState.decisionReason,
        contractBid: round.bidState.contractBid,
        contractTeam: round.bidState.contractTeam,
        contractMade: round.bidState.contractMade,
        nextMinimumBid: round.bidState.highestBid === null
          ? round.bidState.minimumBid
          : round.bidState.highestBid < round.bidState.maximumBid ? round.bidState.highestBid + 1 : null,
        canBid: isPlayer && round.phase === "bidding" && round.bidState.turn === viewerSeat && round.bidState.highestBid !== round.bidState.maximumBid,
        canPass: isPlayer && round.phase === "bidding" && round.bidState.turn === viewerSeat,
        canDecide: isPlayer && round.phase === "auction_decision" && round.bidState.decisionSeat === viewerSeat,
        canKeep: isPlayer && round.phase === "auction_decision" && round.bidState.decisionSeat === viewerSeat,
        canGive: isPlayer && round.phase === "auction_decision" && round.bidState.decisionSeat === viewerSeat
      },
      trump: round.trumpRevealed || (isPlayer && round.caller === viewerSeat) ? round.trump : null,
      trumpRevealed: round.trumpRevealed,
      canRevealTrump: isPlayer && round.mode === "hidden" && !round.trumpRevealed && round.turn === viewerSeat && (viewerSeat === round.caller && !round.trick.length || (round.trick.length && !round.hands[viewerSeat].some((card) => card.suit === round.trick[0].card.suit))),
      turn: round.turn,
      turnDeadline: round.turnDeadline || null,
      pendingWinner: round.pendingWinner,
      trick: round.trick,
      tricks: round.tricks,
      collectedBySeat: round.collectedBySeat,
      winner: round.winner,
      court: round.court,
      hand: visibleHand,
      handCounts: round.hands.map((hand) => hand.length)
    },
    suits: SUITS,
    settings: room.settings,
    options: { deckSizes: DECK_SIZES, modes: MODES, tableThemes: TABLE_THEMES, avatarIds: AVATAR_IDS }
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
    recordRoundResult(room, round);
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
  if (isBot(room, expectedSeat)) return scheduleBotAction(room);
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

function botTrump(round, seat) {
  const cards = round.hands[seat].slice(0, 5);
  return SUITS.reduce((best, suit) => cards.filter((card) => card.suit === suit).length > cards.filter((card) => card.suit === best).length ? suit : best, SUITS[0]);
}

function botBid(round, seat) {
  const bidState = round.bidState;
  const nextBid = bidState.highestBid === null ? bidState.minimumBid : bidState.highestBid + 1;
  if (nextBid > bidState.maximumBid) return null;
  const ceiling = botBidCeiling(round, seat);
  if (bidState.highestBid === null && ceiling === bidState.minimumBid && botHandConfidence(round, seat) < 2) return null;
  return nextBid <= ceiling ? nextBid : null;
}

function botHandConfidence(round, seat) {
  const cards = round.hands[seat].slice(0, 5);
  const highCards = cards.filter((card) => card.value >= 10).length;
  const bestSuitCount = Math.max(...SUITS.map((suit) => cards.filter((card) => card.suit === suit).length));
  return highCards + Math.max(0, bestSuitCount - 2);
}

function botBidCeiling(round, seat) {
  const bidState = round.bidState;
  const confidence = botHandConfidence(round, seat);
  const ceiling = Math.min(bidState.maximumBid, bidState.minimumBid + (confidence >= 3 ? 1 : 0) + (confidence >= 5 ? 1 : 0));
  return ceiling;
}

function botAuctionDecision(round, seat) {
  const bidState = round.bidState;
  if (teamForSeat(bidState.highestBidder) === teamForSeat(seat)) return "give";
  return bidState.highestBid <= botBidCeiling(round, seat) ? "keep" : "give";
}

function botPlay(round, seat) {
  const hand = round.hands[seat];
  const leadSuit = round.trick[0]?.card.suit;
  let legal = leadSuit ? hand.filter((card) => card.suit === leadSuit) : hand;
  if (!legal.length) legal = hand;
  if (round.mustTrumpSeat === seat) {
    const trumps = hand.filter((card) => card.suit === round.trump);
    if (trumps.length) legal = trumps;
  }
  return legal.slice().sort((a, b) => a.value - b.value)[0];
}

function scheduleBotAction(room) {
  clearTurnTimer(room);
  const round = room.round;
  if (!round) return;
  const botSeat = round.phase === "bidding" ? round.bidState?.turn
    : round.phase === "auction_decision" ? round.bidState?.decisionSeat
      : round.phase === "choosing_trump" ? round.caller
        : round.phase === "playing" ? round.turn : null;
  if (botSeat === null || botSeat === undefined || !isBot(room, botSeat)) return;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    if (room.round !== round || !isBot(room, botSeat)) return;
    if (round.phase === "bidding" && round.bidState?.turn === botSeat) {
      const bid = botBid(round, botSeat);
      if (bid === null) passBid(round, botSeat);
      else placeBid(round, botSeat, bid);
      room.updatedAt = Date.now();
      sendRoom(room);
      scheduleBotAction(room);
      return;
    }
    if (round.phase === "auction_decision" && round.bidState?.decisionSeat === botSeat) {
      decideAuction(round, botSeat, botAuctionDecision(round, botSeat));
      room.updatedAt = Date.now();
      sendRoom(room);
      scheduleBotAction(room);
      return;
    }
    if (round.phase === "choosing_trump" && round.caller === botSeat) {
      if (round.mode === "hidden") chooseHiddenTrump(round, botSeat, round.hands[botSeat][0].id);
      else chooseTrump(round, botSeat, botTrump(round, botSeat));
      room.updatedAt = Date.now();
      scheduleTurn(room);
      sendRoom(room);
      return;
    }
    if (round.phase !== "playing" || round.turn !== botSeat) return;
    const card = botPlay(round, botSeat);
    playCard(round, botSeat, card.id);
    room.updatedAt = Date.now();
    if (round.phase === "trick_complete") scheduleCollection(room, round);
    else scheduleTurn(room);
    sendRoom(room);
  }, BOT_ACTION_DELAY_MS);
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
  socket.on("create_room", ({ name, tableTheme, auctionMode, avatarId } = {}, ack) => {
    try {
      const playerName = cleanName(name);
      if (!playerName) throw new Error("Enter your name.");
      const code = makeRoomCode();
      const token = crypto.randomUUID();
      const room = {
        code,
        players: [{
          name: playerName,
          token,
          socketId: socket.id,
          avatarId: normalizeAvatarId(avatarId, defaultAvatarForSeat(0))
        }, null, null, null],
        spectators: [],
        hostSeat: 0,
        dealer: 3,
        round: null,
        score: [0, 0],
        matchTarget: MATCH_TARGET,
        matchWinner: null,
        restartVote: null,
        turnTimer: null,
        tableTheme: DEFAULT_TABLE_THEME,
        settings: { deckSize: DEFAULT_DECK_SIZE, mode: DEFAULT_MODE, auctionMode: false },
        updatedAt: Date.now()
      };
      updateRoomSettings(room, 0, { tableTheme, auctionMode });
      leaveCurrentSocket(socket);
      rooms.set(code, room);
      socket.data = { roomCode: code, role: "player", seat: 0 };
      socket.join(code);
      ack({
        ok: true,
        code,
        token,
        tableTheme: room.tableTheme,
        auctionMode: room.settings.auctionMode,
        avatarId: room.players[0].avatarId
      });
      sendRoom(room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("join_room", ({ code, name, token, avatarId } = {}, ack) => {
    try {
      const normalizedCode = String(code || "").trim().toUpperCase();
      const room = rooms.get(normalizedCode);
      if (!room) throw new Error("Room not found. Check the code.");
      leaveCurrentSocket(socket);

      let seat = token ? room.players.findIndex((item) => item?.token === token) : -1;
      if (seat < 0) {
        if (room.round) throw new Error("This game has already started.");
        seat = room.players.findIndex((item) => !item);
        if (seat < 0 && !room.round) seat = room.players.findIndex((item) => item?.bot);
        if (seat < 0) throw new Error("This room is full.");
        const playerName = cleanName(name);
        if (!playerName) throw new Error("Enter your name.");
        token = crypto.randomUUID();
        room.players[seat] = {
          name: playerName,
          token,
          socketId: socket.id,
          avatarId: normalizeAvatarId(avatarId, defaultAvatarForSeat(seat))
        };
      } else {
        room.players[seat].socketId = socket.id;
        if (!room.round && avatarId !== undefined) room.players[seat].avatarId = normalizeAvatarId(avatarId, room.players[seat].avatarId);
      }

      socket.data = { roomCode: normalizedCode, role: "player", seat };
      socket.join(normalizedCode);
      room.updatedAt = Date.now();
      ack({ ok: true, code: normalizedCode, token, seat, avatarId: room.players[seat].avatarId });
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
      assertMatchOpen(room);
      if (room.players.some((player) => !player)) throw new Error("Four players are required.");
      if (room.round && room.round.phase !== "round_over") throw new Error("A round is already active.");
      room.round = createRound(room.dealer, room.settings);
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
      scheduleBotAction(room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("fill_bots", (_payload, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error("Join a room first.");
      if (seat !== room.hostSeat) throw new Error("Only the host can add bots.");
      if (room.round) throw new Error("Bots can only be added before the game starts.");
      room.players = room.players.map((player, index) => player || makeBot(index));
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("choose_team", ({ team } = {}, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error("Join a room first.");
      const newSeat = chooseRoomTeam(room, seat, team);
      socket.data.seat = newSeat;
      room.updatedAt = Date.now();
      ack({ ok: true, seat: newSeat, team: teamForSeat(newSeat) });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("choose_avatar", ({ avatarId } = {}, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error("Join a room first.");
      const selectedAvatarId = chooseRoomAvatar(room, seat, avatarId);
      room.updatedAt = Date.now();
      ack({ ok: true, avatarId: selectedAvatarId });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("update_settings", (updates = {}, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new Error("Join a room first.");
      updateRoomSettings(room, seat, updates);
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("place_bid", ({ bid } = {}, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round) throw new Error("No active round.");
      placeBid(room.round, seat, bid);
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
      scheduleBotAction(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("pass_bid", (_payload, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round) throw new Error("No active round.");
      passBid(room.round, seat);
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
      scheduleBotAction(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("decide_auction", ({ decision } = {}, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round) throw new Error("No active round.");
      decideAuction(room.round, seat, decision);
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
      scheduleBotAction(room);
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
      scheduleBotAction(room);
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
      assertMatchOpen(room);
      room.dealer = (room.dealer + 1) % 4;
      room.round = createRound(room.dealer, room.settings);
      room.restartVote = null;
      room.updatedAt = Date.now();
      ack({ ok: true });
      sendRoom(room);
      scheduleBotAction(room);
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
      scheduleBotAction(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("request_restart", (_payload, ack) => {
    try {
      const seat = playerSeat(socket);
      const room = rooms.get(socket.data.roomCode);
      if (!room?.round) throw new Error("Start a game first.");
      if (room.restartVote) throw new Error("A restart vote is already active.");
      room.restartVote = { requesterSeat: seat, approvals: [seat] };
      room.players.forEach((player, index) => {
        if (player?.bot && !room.restartVote.approvals.includes(index)) room.restartVote.approvals.push(index);
      });
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
      scheduleBotAction(room);
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

if (require.main === module) {
  server.listen(PORT, () => console.log(`Court Piece running at http://localhost:${PORT}`));
}

module.exports = {
  TABLE_THEMES,
  AVATAR_IDS,
  roomView,
  updateRoomSettings,
  chooseRoomTeam,
  chooseRoomAvatar,
  recordRoundResult,
  assertMatchOpen
};
