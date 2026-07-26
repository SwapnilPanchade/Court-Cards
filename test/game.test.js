const test = require("node:test");
const assert = require("node:assert/strict");
const { createDeck, canPlayCard, winningPlay, createRound, placeBid, passBid, decideAuction, chooseTrump, chooseHiddenTrump, passTrump, revealTrump, playCard, collectTrick } = require("../game");
const { TABLE_THEMES, AVATAR_IDS, roomView, updateRoomSettings, chooseRoomTeam, chooseRoomAvatar, recordRoundResult, assertMatchOpen } = require("../server");

const card = (rank, suit, value) => ({ id: `${rank}-${suit}`, rank, suit, value });

test("deck has 52 unique cards", () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((item) => item.id)).size, 52);
});

test("36-card deck runs from six through ace and deals nine each", () => {
  const deck = createDeck(36);
  assert.equal(deck.length, 36);
  assert.equal(deck.some((item) => item.rank === "5"), false);
  assert.equal(deck.filter((item) => item.rank === "6").length, 4);
  const round = createRound(3, { deckSize: 36, mode: "single" }, () => 0.5);
  assert.deepEqual(round.hands.map((hand) => hand.length), [9, 9, 9, 9]);
});

test("player must follow the led suit when possible", () => {
  const hand = [card("A", "hearts", 12), card("2", "clubs", 0)];
  assert.equal(canPlayCard(hand, hand[0], "hearts"), true);
  assert.equal(canPlayCard(hand, hand[1], "hearts"), false);
  assert.equal(canPlayCard([hand[1]], hand[1], "hearts"), true);
});

test("trump beats lead suit and highest trump wins", () => {
  const plays = [
    { seat: 0, card: card("A", "hearts", 12) },
    { seat: 1, card: card("2", "spades", 0) },
    { seat: 2, card: card("K", "hearts", 11) },
    { seat: 3, card: card("10", "spades", 8) }
  ];
  assert.equal(winningPlay(plays, "spades").seat, 3);
});

test("only caller can choose a valid hukum", () => {
  const round = createRound(3, {}, () => 0.5);
  assert.throws(() => chooseTrump(round, 1, "hearts"));
  chooseTrump(round, 0, "hearts");
  assert.equal(round.phase, "playing");
  assert.equal(round.trump, "hearts");
});

test("caller can pass hukum to the next player but the fourth caller must choose", () => {
  const round = createRound(3, {}, () => 0.5);
  passTrump(round, 0);
  passTrump(round, 1);
  passTrump(round, 2);
  assert.equal(round.caller, 3);
  assert.throws(() => passTrump(round, 3));
});

test("winner of a completed trick leads next", () => {
  const round = {
    phase: "playing", mode: "single", cardsPerPlayer: 1, trump: "spades", trumpRevealed: true, trumpEffectiveFrom: 0, mustTrumpSeat: null, turn: 0, trick: [], completedTricks: [], tricks: [0, 0], collectedBySeat: [0, 0, 0, 0], pendingWinner: null,
    hands: [[card("A", "hearts", 12)], [card("2", "hearts", 0)], [card("K", "hearts", 11)], [card("3", "hearts", 1)]]
  };
  playCard(round, 0, "A-hearts");
  playCard(round, 1, "2-hearts");
  playCard(round, 2, "K-hearts");
  playCard(round, 3, "3-hearts");
  assert.equal(round.phase, "trick_complete");
  assert.equal(round.trick.length, 4);
  collectTrick(round);
  assert.equal(round.turn, 0);
  assert.deepEqual(round.tricks, [1, 0]);
  assert.deepEqual(round.collectedBySeat, [1, 0, 0, 0]);
});

test("deal keeps playing after a majority until every card is played", () => {
  const round = {
    phase: "playing", mode: "single", cardsPerPlayer: 13, trump: "clubs", trumpRevealed: true, trumpEffectiveFrom: 0, mustTrumpSeat: null, turn: 0, trick: [], completedTricks: [], tricks: [6, 0], collectedBySeat: [6, 0, 0, 0], pendingWinner: null,
    hands: [[card("A", "hearts", 12)], [card("2", "hearts", 0)], [card("K", "hearts", 11)], [card("3", "hearts", 1)]]
  };
  [0, 1, 2, 3].forEach((seat) => playCard(round, seat, round.hands[seat][0].id));
  collectTrick(round);
  assert.equal(round.phase, "playing");
  assert.equal(round.turn, 0);
});

test("all modes and auction score every actual team trick through the full deal", () => {
  ["single", "double", "hidden"].forEach((mode) => {
    [false, true].forEach((auctionMode) => {
      const round = createRound(3, { deckSize: 20, mode, auctionMode }, () => 0.5);
      assert.equal("capturedBySeat" in round, false);
      assert.equal("pool" in round, false);
      assert.equal("lastTrickWinner" in round, false);
      if (auctionMode) [0, 1, 2, 3].forEach((seat) => passBid(round, seat));
      if (mode === "hidden") chooseHiddenTrump(round, round.caller, round.hands[round.caller][0].id);
      else chooseTrump(round, round.caller, "clubs");

      const forceTrick = (winnerSeat, trickNumber) => {
        const leader = round.turn;
        round.hands = [0, 1, 2, 3].map((seat) => [card(`T${trickNumber}-${seat}`, "hearts", seat === winnerSeat ? 12 : seat)]);
        [0, 1, 2, 3].forEach((offset) => {
          const seat = (leader + offset) % 4;
          playCard(round, seat, round.hands[seat][0].id);
        });
        collectTrick(round);
        const actualTeamWins = [
          round.collectedBySeat[0] + round.collectedBySeat[2],
          round.collectedBySeat[1] + round.collectedBySeat[3]
        ];
        assert.deepEqual(round.tricks, actualTeamWins, `${mode}, auction=${auctionMode}`);
      };

      forceTrick(0, 1);
      forceTrick(1, 2);
      forceTrick(1, 3);
      forceTrick(1, 4);
      assert.equal(round.phase, "playing", "majority must not hide the final cards");
      forceTrick(1, 5);

      assert.equal(round.phase, "round_over");
      assert.deepEqual(round.tricks, [1, 4]);
      assert.equal(round.completedTricks.length, round.cardsPerPlayer);
      assert.equal(round.winner, 1);
      if (auctionMode) assert.equal(round.bidState.contractMade, false);
    });
  });
});

test("hidden sir keeps selected trump secret until a valid reveal", () => {
  const round = createRound(3, { mode: "hidden" }, () => 0.5);
  const selected = round.hands[0][0];
  chooseHiddenTrump(round, 0, selected.id);
  assert.equal(round.trumpRevealed, false);
  revealTrump(round, 0);
  assert.equal(round.trumpRevealed, true);
  assert.equal(round.mustTrumpSeat, 0);
});

function contestedAuction() {
  const round = createRound(3, { deckSize: 36, mode: "single", auctionMode: true }, () => 0.5);
  placeBid(round, 0, 5);
  placeBid(round, 1, 6);
  passBid(round, 2);
  passBid(round, 3);
  return round;
}

test("auction visits every player once and waits for the original caller's decision", () => {
  const round = createRound(3, { deckSize: 36, mode: "single", auctionMode: true }, () => 0.5);
  assert.equal(round.phase, "bidding");
  assert.equal(round.bidState.minimumBid, 5);
  assert.equal(round.bidState.maximumBid, 9);
  placeBid(round, 0, 5);
  assert.throws(() => placeBid(round, 1, 5), /Bid 6/);
  placeBid(round, 1, 6);
  passBid(round, 2);
  passBid(round, 3);
  assert.equal(round.phase, "auction_decision");
  assert.equal(round.caller, 0);
  assert.equal(round.turn, 0);
  assert.equal(round.bidState.contractBid, 6);
  assert.equal(round.bidState.contractTeam, null);
  assert.equal(round.bidState.decisionSeat, 0);
  assert.equal(round.bidState.decision, null);
  assert.equal(round.bidState.complete, false);
  assert.deepEqual(round.bidState.actedSeats, [0, 1, 2, 3]);
});

test("original caller can keep hukum by matching the highest contract", () => {
  const round = contestedAuction();
  assert.throws(() => decideAuction(round, 1, "give"), /original hukum caller/i);
  assert.throws(() => decideAuction(round, 0, "raise"), /keep or give/i);
  decideAuction(round, 0, "keep");
  assert.equal(round.phase, "choosing_trump");
  assert.equal(round.caller, 0);
  assert.equal(round.turn, 0);
  assert.equal(round.bidState.highestBidder, 1);
  assert.equal(round.bidState.contractBid, 6);
  assert.equal(round.bidState.contractTeam, 0);
  assert.equal(round.bidState.decision, "keep");
  assert.equal(round.bidState.complete, true);
  assert.equal(round.bidState.history.at(-1).action, "keep");
  assert.throws(() => passTrump(round, 0), /auction winner/i);
});

test("original caller can give hukum and its contract to the highest bidder", () => {
  const round = contestedAuction();
  decideAuction(round, 0, "give");
  assert.equal(round.phase, "choosing_trump");
  assert.equal(round.caller, 1);
  assert.equal(round.turn, 1);
  assert.equal(round.bidState.contractBid, 6);
  assert.equal(round.bidState.contractTeam, 1);
  assert.equal(round.bidState.decision, "give");
  assert.equal(round.bidState.history.at(-1).awardedSeat, 1);
});

test("all-pass auction forces the opening caller at the normal majority", () => {
  const round = createRound(3, { deckSize: 20, auctionMode: true }, () => 0.5);
  [0, 1, 2, 3].forEach((seat) => passBid(round, seat));
  assert.equal(round.phase, "choosing_trump");
  assert.equal(round.caller, 0);
  assert.equal(round.bidState.contractBid, 3);
  assert.equal(round.bidState.contractTeam, 0);
  assert.equal(round.bidState.complete, true);
  assert.equal(round.bidState.decision, "auto_keep");
  assert.equal(round.bidState.decisionReason, "all_pass");
  assert.equal(round.bidState.history.at(-1).action, "forced_bid");
});

test("opening caller auto-keeps when already the highest bidder", () => {
  const round = createRound(3, { deckSize: 20, auctionMode: true }, () => 0.5);
  placeBid(round, 0, 3);
  [1, 2, 3].forEach((seat) => passBid(round, seat));
  assert.equal(round.phase, "choosing_trump");
  assert.equal(round.caller, 0);
  assert.equal(round.bidState.contractBid, 3);
  assert.equal(round.bidState.contractTeam, 0);
  assert.equal(round.bidState.decision, "auto_keep");
  assert.equal(round.bidState.decisionReason, "opening_highest");
});

function finalTrickRound({
  contractTeam = null,
  contractBid = null,
  finalWinnerSeat = 0,
  cardsPerPlayer = 5,
  preTricks = [2, 2],
  caller = 0
} = {}) {
  const ranks = ["2", "3", "4", "5"];
  const values = [0, 1, 2, 3];
  ranks[finalWinnerSeat] = "A";
  values[finalWinnerSeat] = 12;
  return {
    phase: "playing",
    mode: "single",
    cardsPerPlayer,
    auctionMode: contractTeam !== null,
    bidState: contractTeam === null ? null : { contractTeam, contractBid, contractMade: null },
    caller,
    trump: "clubs",
    trumpRevealed: true,
    trumpEffectiveFrom: 0,
    mustTrumpSeat: null,
    turn: 0,
    trick: [],
    completedTricks: Array.from({ length: cardsPerPlayer - 1 }, () => ({})),
    tricks: [...preTricks],
    collectedBySeat: [2, 2, 0, 0],
    pendingWinner: null,
    winner: null,
    court: false,
    resultRecorded: false,
    hands: ranks.map((rank, seat) => [card(rank, "hearts", values[seat])])
  };
}

function finishFinalTrick(round) {
  [0, 1, 2, 3].forEach((seat) => playCard(round, seat, round.hands[seat][0].id));
  collectTrick(round);
  return round;
}

[
  { name: "Team A makes its contract", contractTeam: 0, finalWinnerSeat: 0, bid: 3, tricks: [3, 2], made: true, winner: 0 },
  { name: "Team A fails its contract", contractTeam: 0, finalWinnerSeat: 0, bid: 4, tricks: [3, 2], made: false, winner: 1 },
  { name: "Team B makes its contract", contractTeam: 1, finalWinnerSeat: 1, bid: 3, tricks: [2, 3], made: true, winner: 1 },
  { name: "Team B fails its contract", contractTeam: 1, finalWinnerSeat: 1, bid: 4, tricks: [2, 3], made: false, winner: 0 }
].forEach((scenario) => {
  test(`auction scoring: ${scenario.name}`, () => {
    const round = finishFinalTrick(finalTrickRound({
      contractTeam: scenario.contractTeam,
      contractBid: scenario.bid,
      finalWinnerSeat: scenario.finalWinnerSeat
    }));
    assert.equal(round.phase, "round_over");
    assert.deepEqual(round.tricks, scenario.tricks);
    assert.equal(round.tricks[0] + round.tricks[1], round.cardsPerPlayer);
    assert.equal(round.bidState.contractMade, scenario.made);
    assert.equal(round.winner, scenario.winner);
  });
});

test("an even-trick tie is a failed majority for the hukum caller's team", () => {
  const callerTeamA = finishFinalTrick(finalTrickRound({
    cardsPerPlayer: 6,
    preTricks: [2, 3],
    finalWinnerSeat: 0,
    caller: 0
  }));
  assert.deepEqual(callerTeamA.tricks, [3, 3]);
  assert.equal(callerTeamA.winner, 1);

  const callerTeamB = finishFinalTrick(finalTrickRound({
    cardsPerPlayer: 6,
    preTricks: [2, 3],
    finalWinnerSeat: 0,
    caller: 1
  }));
  assert.deepEqual(callerTeamB.tricks, [3, 3]);
  assert.equal(callerTeamB.winner, 0);
});

function testRoom(players = [{ name: "Host" }, null, null, null]) {
  return {
    code: "TEST1",
    players,
    spectators: [],
    hostSeat: 0,
    round: null,
    score: [0, 0],
    matchTarget: 2,
    matchWinner: null,
    restartVote: null,
    tableTheme: "noir",
    settings: { deckSize: 36, mode: "single", auctionMode: false }
  };
}

test("room themes and auction mode are validated and exposed", () => {
  const room = testRoom([{ name: "Host", token: "h", socketId: "s" }, null, null, null]);
  updateRoomSettings(room, 0, { tableTheme: "neon", auctionMode: true });
  assert.equal(room.tableTheme, "neon");
  assert.equal(room.settings.auctionMode, true);
  assert.deepEqual(TABLE_THEMES, ["noir", "comic", "neon", "adda", "gully"]);
  assert.throws(() => updateRoomSettings(room, 0, { tableTheme: "casino" }), /valid table theme/);

  room.players = [0, 1, 2, 3].map((seat) => ({ name: `P${seat}`, token: `t${seat}`, socketId: `s${seat}` }));
  room.round = createRound(3, room.settings, () => 0.5);
  const view = roomView(room, { role: "player", seat: 0 });
  assert.equal(view.tableTheme, "neon");
  assert.equal(view.round.phase, "bidding");
  assert.equal(view.round.hand.length, 5);
  assert.equal(view.round.bidState.canBid, true);
  assert.equal(view.round.bidState.nextMinimumBid, 5);

  room.round = contestedAuction();
  const ownerView = roomView(room, { role: "player", seat: 0 });
  const bidderView = roomView(room, { role: "player", seat: 1 });
  assert.equal(ownerView.round.phase, "auction_decision");
  assert.equal(ownerView.round.hand.length, 5);
  assert.equal(ownerView.round.bidState.canDecide, true);
  assert.equal(ownerView.round.bidState.canKeep, true);
  assert.equal(ownerView.round.bidState.canGive, true);
  assert.equal(bidderView.round.bidState.canDecide, false);
  assert.equal(bidderView.round.bidState.contractTeam, null);
});

test("room view exposes one actual team trick tally for every mode", () => {
  ["single", "double", "hidden"].forEach((mode) => {
    const room = testRoom([0, 1, 2, 3].map((seat) => ({
      name: `P${seat}`,
      token: `t${seat}`,
      socketId: `s${seat}`
    })));
    room.round = createRound(3, { deckSize: 20, mode }, () => 0.5);
    room.round.phase = "playing";
    room.round.tricks = [3, 0];
    room.round.collectedBySeat = [1, 0, 2, 0];

    const view = roomView(room, { role: "player", seat: 0 });
    assert.deepEqual(view.round.tricks, [3, 0]);
    assert.equal("wonTricks" in view.round, false);
  });
});

test("team choice prefers an empty seat, can replace a bot, and rejects a full human team", () => {
  const host = { name: "Host" };
  const bot = { name: "Bot", bot: true };
  const room = testRoom([host, bot, { name: "Partner" }, null]);
  assert.equal(chooseRoomTeam(room, 0, "B"), 3);
  assert.equal(room.players[3], host);
  assert.equal(room.players[1], bot);
  assert.equal(room.hostSeat, 3);

  const botRoom = testRoom([host, bot, { name: "Partner" }, { name: "Opponent" }]);
  assert.equal(chooseRoomTeam(botRoom, 0, 1), 1);
  assert.equal(botRoom.players[1], host);

  const fullRoom = testRoom([{ name: "P0" }, { name: "P1" }, { name: "P2" }, { name: "P3" }]);
  assert.throws(() => chooseRoomTeam(fullRoom, 0, "B"), /Team B is full/);
});

test("room avatars are validated, exposed, and locked after play starts", () => {
  const room = testRoom([{ name: "Host", token: "h", socketId: "s", avatarId: "jugaadu" }, null, null, null]);
  assert.deepEqual(AVATAR_IDS, [
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
  assert.equal(chooseRoomAvatar(room, 0, "sher"), "sher");
  assert.equal(room.players[0].avatarId, "sher");
  assert.throws(() => chooseRoomAvatar(room, 0, "unknown"), /valid avatar/);

  const lobbyView = roomView(room, { role: "player", seat: 0 });
  assert.equal(lobbyView.players[0].avatarId, "sher");
  assert.deepEqual(lobbyView.options.avatarIds, AVATAR_IDS);

  room.round = createRound(3, room.settings, () => 0.5);
  assert.throws(() => chooseRoomAvatar(room, 0, "jugaadu"), /cannot change after the game starts/);
});

test("round result gives exactly one point to the winning team and resolves the match target", () => {
  const room = testRoom();
  assert.doesNotThrow(() => assertMatchOpen(room));
  const firstWin = { winner: 1, resultRecorded: false };
  recordRoundResult(room, firstWin);
  assert.deepEqual(room.score, [0, 1]);
  assert.equal(room.matchWinner, null);

  recordRoundResult(room, firstWin);
  assert.deepEqual(room.score, [0, 1]);

  recordRoundResult(room, { winner: 1, resultRecorded: false });
  assert.deepEqual(room.score, [0, 2]);
  assert.equal(room.matchWinner, 1);
  assert.throws(() => assertMatchOpen(room), /Match is complete/);
  assert.throws(() => recordRoundResult(room, { winner: null }), /winner is not resolved/i);
});
