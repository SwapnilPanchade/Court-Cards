const test = require("node:test");
const assert = require("node:assert/strict");
const { createDeck, canPlayCard, winningPlay, createRound, chooseTrump, chooseHiddenTrump, passTrump, revealTrump, playCard, collectTrick } = require("../game");

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
    phase: "playing", mode: "single", cardsPerPlayer: 1, trump: "spades", trumpRevealed: true, trumpEffectiveFrom: 0, mustTrumpSeat: null, turn: 0, trick: [], completedTricks: [], tricks: [0, 0], capturedBySeat: [0, 0, 0, 0], collectedBySeat: [0, 0, 0, 0], pool: 0, lastTrickWinner: null, pendingWinner: null,
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
  assert.deepEqual(round.capturedBySeat, [1, 0, 0, 0]);
});

test("single sir keeps playing after a majority until every card is played", () => {
  const round = {
    phase: "playing", mode: "single", cardsPerPlayer: 13, trump: "clubs", trumpRevealed: true, trumpEffectiveFrom: 0, mustTrumpSeat: null, turn: 0, trick: [], completedTricks: [], tricks: [6, 0], capturedBySeat: [6, 0, 0, 0], collectedBySeat: [6, 0, 0, 0], pool: 0, lastTrickWinner: null, pendingWinner: null,
    hands: [[card("A", "hearts", 12)], [card("2", "hearts", 0)], [card("K", "hearts", 11)], [card("3", "hearts", 1)]]
  };
  [0, 1, 2, 3].forEach((seat) => playCard(round, seat, round.hands[seat][0].id));
  collectTrick(round);
  assert.equal(round.phase, "playing");
  assert.equal(round.turn, 0);
});

test("double sir collects the pool only for the same player's consecutive wins", () => {
  const round = createRound(3, { deckSize: 20, mode: "double" }, () => 0.5);
  round.phase = "playing";
  round.trump = "clubs";
  round.trumpRevealed = true;
  const forceTrick = (winnerSeat) => {
    const ranks = ["2", "3", "4", "5"];
    round.turn = 0;
    round.hands = [0, 1, 2, 3].map((seat) => [card(ranks[seat], "hearts", seat === winnerSeat ? 12 : seat)]);
    [0, 1, 2, 3].forEach((seat) => playCard(round, seat, round.hands[seat][0].id));
    collectTrick(round);
  };
  forceTrick(0);
  assert.deepEqual(round.tricks, [0, 0]);
  assert.equal(round.pool, 1);
  assert.deepEqual(round.collectedBySeat, [1, 0, 0, 0]);
  forceTrick(2);
  assert.deepEqual(round.tricks, [0, 0]);
  forceTrick(2);
  assert.deepEqual(round.tricks, [3, 0]);
  assert.equal(round.pool, 0);
  assert.deepEqual(round.collectedBySeat, [1, 0, 2, 0]);
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
