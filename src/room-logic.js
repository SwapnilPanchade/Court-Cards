import {
  SUITS,
  DECK_SIZES,
  MODES,
  createRound as createCourtPieceRound,
  placeBid,
  passBid,
  decideAuction,
  chooseTrump,
  chooseHiddenTrump,
  passTrump,
  revealTrump,
  playCard,
  collectTrick,
  teamForSeat
} from "./game.js";
import {
  createJudgmentRound,
  placeJudgmentCall,
  playJudgmentCard,
  collectJudgmentTrick,
  botJudgmentCall,
  botJudgmentCard,
  pickJudgmentTimeoutCard
} from "./judgment.js";
import {
  createRummyRound,
  drawRummyCard,
  discardRummyCard,
  botRummyDrawSource,
  botRummyDiscard
} from "./rummy.js";

export const TABLE_THEMES = ["noir", "comic", "neon", "adda", "gully"];
export const GAME_TYPES = ["court-piece", "judgment", "rummy"];
export const DEFAULT_GAME_TYPE = "court-piece";
export const DEFAULT_TABLE_THEME = "noir";
export const AVATAR_IDS = Object.freeze([
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
export const DEFAULT_AVATAR_ID = AVATAR_IDS[0];
export const DEFAULT_DECK_SIZE = 36;
export const DEFAULT_MODE = "single";
export const TURN_TIMEOUT_MS = 40_000;
export const BOT_ACTION_DELAY_MS = 650;
export const COLLECTION_MS = 1_600;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeRoomCode(randomInt = (max) => Math.floor(Math.random() * max)) {
  return Array.from({ length: 5 }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join("");
}

export function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").replace(/[<>&"']/g, "").slice(0, 18);
}

export function normalizeAvatarId(value, fallback = DEFAULT_AVATAR_ID) {
  const avatarId = value === undefined || value === null || value === ""
    ? fallback
    : String(value).trim().toLowerCase();
  if (!AVATAR_IDS.includes(avatarId)) throw new Error("Choose a valid avatar.");
  return avatarId;
}

export function defaultAvatarForSeat(seat) {
  return AVATAR_IDS[Math.abs(Number(seat) || 0) % AVATAR_IDS.length];
}

export function makeBot(seat, randomUUID = () => crypto.randomUUID()) {
  const titles = ["Ace", "Queen", "King", "Jack"];
  return {
    name: `${titles[seat]} Bot`,
    token: `bot-${randomUUID()}`,
    socketId: null,
    bot: true,
    avatarId: defaultAvatarForSeat(seat)
  };
}

export function isBot(room, seat) {
  return Boolean(room.players[seat]?.bot);
}

export function humanSeats(room) {
  return room.players
    .map((player, seat) => (player && !player.bot ? seat : -1))
    .filter((seat) => seat >= 0);
}

export function hasHumans(room) {
  return humanSeats(room).length > 0;
}

export const HUMAN_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export function markHumanActivity(room, now = Date.now()) {
  room.lastHumanActivityAt = now;
  return room.lastHumanActivityAt;
}

export function humanIdleDeadline(room) {
  return Number(room.lastHumanActivityAt || room.updatedAt || Date.now()) + HUMAN_IDLE_TIMEOUT_MS;
}

export function isHumanIdle(room, now = Date.now()) {
  return now >= humanIdleDeadline(room);
}

export function botSeats(room) {
  return room.players
    .map((player, seat) => (player?.bot ? seat : -1))
    .filter((seat) => seat >= 0);
}

export function emptySeats(room) {
  return room.players
    .map((player, seat) => (player ? -1 : seat))
    .filter((seat) => seat >= 0);
}

export function normalizeTeam(value) {
  const normalized = String(value).toUpperCase();
  if (value === 0 || normalized === "0" || normalized === "A") return 0;
  if (value === 1 || normalized === "1" || normalized === "B") return 1;
  throw new Error("Choose Team A or Team B.");
}

export function normalizeGameType(value, fallback = DEFAULT_GAME_TYPE) {
  const gameType = String(value || fallback).trim().toLowerCase();
  if (!GAME_TYPES.includes(gameType)) throw new Error("Choose a valid game.");
  return gameType;
}

export function createRound(dealer, settings = {}, random = Math.random) {
  const gameType = normalizeGameType(settings.gameType);
  if (gameType === "judgment") return createJudgmentRound(dealer, random);
  if (gameType === "rummy") return createRummyRound(dealer, random);
  return createCourtPieceRound(dealer, settings, random);
}

export function placeGameCall(round, seat, value) {
  if (round.gameType === "judgment") return placeJudgmentCall(round, seat, value);
  throw new Error("This game does not use calls.");
}

export function playGameCard(round, seat, cardId) {
  if (round.gameType === "judgment") return playJudgmentCard(round, seat, cardId);
  return playCard(round, seat, cardId);
}

export function collectGameTrick(round) {
  if (round.gameType === "judgment") return collectJudgmentTrick(round);
  return collectTrick(round);
}

export function createEmptyRoom(code, hostPlayer, options = {}) {
  const gameType = normalizeGameType(options.gameType);
  const room = {
    code,
    gameType,
    players: [hostPlayer, null, null, null],
    spectators: [],
    hostSeat: 0,
    dealer: 3,
    round: null,
    score: gameType === "court-piece" ? [0, 0] : [0, 0, 0, 0],
    matchTarget: null,
    matchWinner: null,
    restartVote: null,
    teamSwitchRequest: null,
    alarm: null,
    tableTheme: DEFAULT_TABLE_THEME,
    settings: {
      deckSize: DEFAULT_DECK_SIZE,
      mode: DEFAULT_MODE,
      auctionMode: false,
      gameType
    },
    settingsLocked: false,
    destroyed: false,
    lastHumanActivityAt: Date.now(),
    updatedAt: Date.now()
  };
  updateRoomSettings(room, 0, {
    tableTheme: options.tableTheme,
    auctionMode: options.auctionMode
  });
  return room;
}

export function updateRoomSettings(room, seat, updates = {}) {
  if (seat !== room.hostSeat) throw new Error("Only the host can change settings.");
  if (room.round || room.settingsLocked) throw new Error("Settings cannot change after the game starts.");

  const deckSize = updates.deckSize === undefined ? room.settings.deckSize : Number(updates.deckSize);
  const mode = updates.mode === undefined ? room.settings.mode : updates.mode;
  const auctionMode = updates.auctionMode === undefined ? Boolean(room.settings.auctionMode) : updates.auctionMode;
  const tableTheme = updates.tableTheme === undefined ? (room.tableTheme || DEFAULT_TABLE_THEME) : updates.tableTheme;

  if (room.gameType && room.gameType !== "court-piece") return room;
  if (!DECK_SIZES.includes(deckSize) || !MODES.includes(mode)) throw new Error("Choose valid game settings.");
  if (typeof auctionMode !== "boolean") throw new Error("Auction mode must be on or off.");
  if (!TABLE_THEMES.includes(tableTheme)) throw new Error("Choose a valid table theme.");

  room.settings = { deckSize, mode, auctionMode };
  room.tableTheme = tableTheme;
  return room;
}

export function chooseRoomTeam(room, seat, requestedTeam) {
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
  if (room.teamSwitchRequest) room.teamSwitchRequest = null;
  return targetSeat;
}

export function chooseRoomAvatar(room, seat, requestedAvatarId) {
  if (room.round) throw new Error("Avatars cannot change after the game starts.");
  const player = room.players[seat];
  if (!player || player.bot) throw new Error("Only a seated player can choose an avatar.");
  player.avatarId = normalizeAvatarId(requestedAvatarId);
  return player.avatarId;
}

export function recordRoundResult(room, round) {
  if (room.gameType && room.gameType !== "court-piece") {
    if (!round || round.phase !== "round_over" || round.resultRecorded) return null;
    round.resultRecorded = true;
    room.score = (round.roundScores || room.score).map((score, seat) => Number((room.score[seat] + score).toFixed(1)));
    room.matchWinner = round.winner;
    return null;
  }
  if (!round || (round.winner !== 0 && round.winner !== 1)) throw new Error("Round winner is not resolved.");
  if (round.resultRecorded) return null;
  round.resultRecorded = true;
  room.score[round.winner] += 1;
  room.matchWinner = null;
  return null;
}

export function assertMatchOpen(_room) {
  // Scores persist for the life of the room; matches never auto-close.
}

export function canRequestTeamSwitch(room) {
  return !room.round || room.round.phase === "round_over";
}

export function requestTeamSwitch(room, fromSeat, targetSeat) {
  if (!canRequestTeamSwitch(room)) throw new Error("Team switches are not allowed mid-round.");
  const from = room.players[fromSeat];
  const to = room.players[targetSeat];
  if (!from || from.bot) throw new Error("Only a seated player can request a team switch.");
  if (!Number.isInteger(targetSeat) || targetSeat < 0 || targetSeat > 3) throw new Error("Choose a valid seat.");
  if (targetSeat === fromSeat) throw new Error("Pick a different seat.");
  if (!to || to.bot) throw new Error("You can only switch with another human player.");
  if (teamForSeat(fromSeat) === teamForSeat(targetSeat)) throw new Error("You are already on the same team.");
  if (room.teamSwitchRequest) throw new Error("A team switch request is already pending.");
  room.teamSwitchRequest = { fromSeat, toSeat: targetSeat };
  return room.teamSwitchRequest;
}

export function respondTeamSwitch(room, seat, accept) {
  const request = room.teamSwitchRequest;
  if (!request) throw new Error("No team switch request is active.");
  if (seat !== request.toSeat) throw new Error("Only the requested player can respond.");
  if (!canRequestTeamSwitch(room)) {
    room.teamSwitchRequest = null;
    throw new Error("Team switches are not allowed mid-round.");
  }
  if (!accept) {
    room.teamSwitchRequest = null;
    return { swapped: false };
  }

  const fromPlayer = room.players[request.fromSeat];
  const toPlayer = room.players[request.toSeat];
  if (!fromPlayer || !toPlayer || fromPlayer.bot || toPlayer.bot) {
    room.teamSwitchRequest = null;
    throw new Error("That switch is no longer available.");
  }

  room.players[request.fromSeat] = toPlayer;
  room.players[request.toSeat] = fromPlayer;
  if (room.hostSeat === request.fromSeat) room.hostSeat = request.toSeat;
  else if (room.hostSeat === request.toSeat) room.hostSeat = request.fromSeat;

  if (room.round?.phase === "round_over") {
    // Seat identities swapped; round_over has no per-seat private state that must move.
  }

  room.teamSwitchRequest = null;
  return { swapped: true, seats: [request.fromSeat, request.toSeat] };
}

export function transferHost(room, fromSeat, targetSeat) {
  if (fromSeat !== room.hostSeat) throw new Error("Only the host can transfer ownership.");
  const target = room.players[targetSeat];
  if (!target || target.bot) throw new Error("Transfer ownership to a human player.");
  if (targetSeat === fromSeat) throw new Error("You are already the host.");
  room.hostSeat = targetSeat;
  return targetSeat;
}

export function assignNextHost(room, leavingSeat) {
  if (room.hostSeat !== leavingSeat) return room.hostSeat;
  const humans = humanSeats(room).filter((seat) => seat !== leavingSeat);
  if (humans.length) {
    room.hostSeat = humans[0];
    return room.hostSeat;
  }
  const any = room.players.findIndex((player, seat) => player && seat !== leavingSeat);
  if (any >= 0) room.hostSeat = any;
  return room.hostSeat;
}

export function leavePlayerSeat(room, seat, { randomUUID = () => crypto.randomUUID() } = {}) {
  const player = room.players[seat];
  if (!player || player.bot) return { destroyed: false, replacedWithBot: false };

  const midGame = Boolean(room.round) && room.round.phase !== "round_over";
  const betweenOrLobby = !room.round || room.round.phase === "round_over";

  assignNextHost(room, seat);

  if (room.teamSwitchRequest
    && (room.teamSwitchRequest.fromSeat === seat || room.teamSwitchRequest.toSeat === seat)) {
    room.teamSwitchRequest = null;
  }
  if (room.restartVote?.approvals) {
    room.restartVote.approvals = room.restartVote.approvals.filter((item) => item !== seat);
    if (room.restartVote.requesterSeat === seat) room.restartVote = null;
  }

  if (midGame) {
    room.players[seat] = makeBot(seat, randomUUID);
    return { destroyed: !hasHumans(room), replacedWithBot: true };
  }

  // Lobby or between rounds: free the seat so someone else can join.
  room.players[seat] = null;
  if (betweenOrLobby && room.round?.phase === "round_over" && !hasHumans(room)) {
    return { destroyed: true, replacedWithBot: false };
  }
  return { destroyed: !hasHumans(room), replacedWithBot: false };
}

export function joinAsPlayer(room, {
  name,
  token,
  avatarId,
  replaceSeat,
  socketId,
  randomUUID = () => crypto.randomUUID()
} = {}) {
  if (room.destroyed) throw new Error("This room no longer exists.");

  let seat = token ? room.players.findIndex((item) => item?.token === token) : -1;
  if (seat >= 0) {
    const existing = room.players[seat];
    if (existing.bot) throw new Error("Invalid session token.");
    existing.socketId = socketId;
    if (!room.round && avatarId !== undefined) {
      existing.avatarId = normalizeAvatarId(avatarId, existing.avatarId);
    }
    return { seat, token: existing.token, avatarId: existing.avatarId, resumed: true };
  }

  const playerName = cleanName(name);
  if (!playerName) throw new Error("Enter your name.");
  const nextToken = randomUUID();
  const nextAvatar = normalizeAvatarId(avatarId, undefined);

  if (replaceSeat !== undefined && replaceSeat !== null && replaceSeat !== "") {
    const target = Number(replaceSeat);
    if (!Number.isInteger(target) || target < 0 || target > 3) throw new Error("Choose a valid bot seat.");
    if (!room.players[target]?.bot) throw new Error("That seat is not a bot.");
    room.players[target] = {
      name: playerName,
      token: nextToken,
      socketId,
      bot: false,
      avatarId: normalizeAvatarId(avatarId, defaultAvatarForSeat(target))
    };
    return { seat: target, token: nextToken, avatarId: room.players[target].avatarId, resumed: false };
  }

  seat = emptySeats(room)[0];
  if (seat === undefined) {
    const bots = botSeats(room);
    if (!bots.length) throw new Error("This room is full.");
    const error = new Error("Choose which bot to replace.");
    error.code = "CHOOSE_BOT";
    error.bots = bots.map((botSeat) => ({
      seat: botSeat,
      name: room.players[botSeat].name,
      avatarId: room.players[botSeat].avatarId,
      team: teamForSeat(botSeat)
    }));
    throw error;
  }

  room.players[seat] = {
    name: playerName,
    token: nextToken,
    socketId,
    bot: false,
    avatarId: normalizeAvatarId(avatarId, defaultAvatarForSeat(seat))
  };
  return { seat, token: nextToken, avatarId: room.players[seat].avatarId, resumed: false };
}

export function publicRoomInfo(room) {
  return {
    code: room.code,
    gameType: room.gameType,
    started: Boolean(room.round),
    settingsLocked: Boolean(room.settingsLocked || room.round),
    emptySeats: emptySeats(room),
    bots: botSeats(room).map((seat) => ({
      seat,
      name: room.players[seat].name,
      avatarId: room.players[seat].avatarId,
      team: teamForSeat(seat)
    })),
    players: room.players.map((item, seat) =>
      item
        ? {
          seat,
          name: item.name,
          bot: Boolean(item.bot),
          team: teamForSeat(seat),
          avatarId: item.avatarId || defaultAvatarForSeat(seat)
        }
        : null
    ),
    score: room.score
  };
}

export function roomView(room, viewer) {
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
    gameType: room.gameType,
    hostSeat: room.hostSeat,
    you: isPlayer
      ? { role: "player", seat: viewerSeat, token: player.token }
      : {
        role: "spectator",
        token: viewer.spectator.token,
        name: viewer.spectator.name,
        watchingSeat: viewerSeat
      },
    players: room.players.map((item, seat) =>
      item
        ? {
          seat,
          name: item.name,
          avatarId: item.avatarId || defaultAvatarForSeat(seat),
          connected: Boolean(item.socketId) || Boolean(item.bot),
          bot: Boolean(item.bot),
          team: teamForSeat(seat)
        }
        : null
    ),
    score: room.score,
    matchTarget: null,
    matchWinner: room.matchWinner,
    tableTheme: room.tableTheme,
    restartVote: room.restartVote,
    teamSwitchRequest: room.teamSwitchRequest,
    canTeamSwitch: canRequestTeamSwitch(room),
    spectators: room.spectators.map((spectator) => ({
      name: spectator.name,
      watchingSeat: spectator.watchingSeat
    })),
    round: round && {
      gameType: room.gameType,
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
      calls: round.calls || null,
      roundScores: round.roundScores || null,
      stockCount: round.stock?.length ?? null,
      discardTop: round.discard?.at(-1) || null,
      drawnThisTurn: round.drawnThisTurn ?? false,
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
    settingsLocked: Boolean(room.settingsLocked || room.round),
    options: { gameTypes: GAME_TYPES, deckSizes: DECK_SIZES, modes: MODES, tableThemes: TABLE_THEMES, avatarIds: AVATAR_IDS }
  };
}

export function botTrump(round, seat) {
  const cards = round.hands[seat].slice(0, 5);
  return SUITS.reduce(
    (best, suit) =>
      cards.filter((card) => card.suit === suit).length > cards.filter((card) => card.suit === best).length
        ? suit
        : best,
    SUITS[0]
  );
}

export function botHandConfidence(round, seat) {
  const cards = round.hands[seat].slice(0, 5);
  const highCards = cards.filter((card) => card.value >= 10).length;
  const bestSuitCount = Math.max(...SUITS.map((suit) => cards.filter((card) => card.suit === suit).length));
  return highCards + Math.max(0, bestSuitCount - 2);
}

export function botBidCeiling(round, seat) {
  const bidState = round.bidState;
  const confidence = botHandConfidence(round, seat);
  return Math.min(
    bidState.maximumBid,
    bidState.minimumBid + (confidence >= 3 ? 1 : 0) + (confidence >= 5 ? 1 : 0)
  );
}

export function botBid(round, seat) {
  const bidState = round.bidState;
  const nextBid = bidState.highestBid === null ? bidState.minimumBid : bidState.highestBid + 1;
  if (nextBid > bidState.maximumBid) return null;
  const ceiling = botBidCeiling(round, seat);
  if (bidState.highestBid === null && ceiling === bidState.minimumBid && botHandConfidence(round, seat) < 2) return null;
  return nextBid <= ceiling ? nextBid : null;
}

export function botAuctionDecision(round, seat) {
  const bidState = round.bidState;
  if (teamForSeat(bidState.highestBidder) === teamForSeat(seat)) return "give";
  return bidState.highestBid <= botBidCeiling(round, seat) ? "keep" : "give";
}

export function botPlay(round, seat) {
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

export function pickTimeoutCard(round, seat, randomInt = (max) => Math.floor(Math.random() * max)) {
  const hand = round.hands[seat];
  const leadSuit = round.trick[0]?.card.suit;
  let legal = leadSuit ? hand.filter((card) => card.suit === leadSuit) : hand;
  if (!legal.length) legal = hand;
  if (round.mustTrumpSeat === seat) {
    const trumps = hand.filter((card) => card.suit === round.trump);
    if (trumps.length) legal = trumps;
  }
  return legal[randomInt(legal.length)];
}

export {
  placeBid,
  passBid,
  decideAuction,
  chooseTrump,
  chooseHiddenTrump,
  passTrump,
  revealTrump,
  playCard,
  collectTrick,
  drawRummyCard,
  discardRummyCard,
  botJudgmentCall,
  botJudgmentCard,
  pickJudgmentTimeoutCard,
  botRummyDrawSource,
  botRummyDiscard,
  teamForSeat,
  SUITS,
  DECK_SIZES,
  MODES
};
