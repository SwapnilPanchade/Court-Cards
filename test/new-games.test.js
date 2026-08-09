import test from "node:test";
import assert from "node:assert/strict";
import {
  createJudgmentRound,
  placeJudgmentCall,
  playJudgmentCard,
  collectJudgmentTrick
} from "../src/judgment.js";
import {
  createRummyRound,
  drawRummyCard,
  discardRummyCard,
  isValidRummyHand
} from "../src/rummy.js";

test("Judgment deals 13 cards, collects calls, and scores a completed round", () => {
  const round = createJudgmentRound(3, () => 0.5);
  assert.equal(round.gameType, "judgment");
  assert.deepEqual(round.hands.map((hand) => hand.length), [13, 13, 13, 13]);
  [2, 2, 2, 2].forEach((call) => placeJudgmentCall(round, round.turn, call));
  assert.equal(round.phase, "playing");
  assert.equal(round.calls.every((call) => call === 2), true);

  for (let trick = 0; trick < 13; trick += 1) {
    while (round.phase === "playing") {
      const seat = round.turn;
      const leadSuit = round.trick[0]?.card.suit;
      const selected = leadSuit
        ? round.hands[seat].find((card) => card.suit === leadSuit) || round.hands[seat][0]
        : round.hands[seat][0];
      playJudgmentCard(round, seat, selected.id);
    }
    collectJudgmentTrick(round);
  }
  assert.equal(round.phase, "round_over");
  assert.equal(round.tricks.reduce((sum, count) => sum + count, 0), 13);
  assert.equal(round.roundScores.every((score) => score >= 0), true);
});

test("Rummy deals 13 cards and enforces draw then discard", () => {
  const round = createRummyRound(3, () => 0.5);
  assert.equal(round.gameType, "rummy");
  assert.deepEqual(round.hands.map((hand) => hand.length), [13, 13, 13, 13]);
  assert.throws(() => discardRummyCard(round, round.turn, round.hands[round.turn][0].id), /Draw a card first/);
  drawRummyCard(round, round.turn, "stock");
  assert.equal(round.hands[round.turn].length, 14);
  discardRummyCard(round, round.turn, round.hands[round.turn][0].id);
  assert.equal(round.hands[0].length, 13);
  assert.equal(round.discard.length, 2);
});

test("Rummy requires two sequences and one pure sequence", () => {
  const valid = [
    { id: "1", suit: "hearts", rank: "2", value: 0 },
    { id: "2", suit: "hearts", rank: "3", value: 1 },
    { id: "3", suit: "hearts", rank: "4", value: 2 },
    { id: "4", suit: "clubs", rank: "5", value: 3 },
    { id: "5", suit: "clubs", rank: "6", value: 4 },
    { id: "6", suit: "clubs", rank: "7", value: 5 },
    { id: "7", suit: "spades", rank: "9", value: 7 },
    { id: "8", suit: "diamonds", rank: "9", value: 7 },
    { id: "9", suit: "hearts", rank: "9", value: 7 },
    { id: "10", suit: "clubs", rank: "9", value: 7 },
    { id: "11", suit: "spades", rank: "K", value: 11 },
    { id: "12", suit: "diamonds", rank: "K", value: 11 },
    { id: "13", suit: "hearts", rank: "K", value: 11 }
  ];
  assert.equal(isValidRummyHand(valid), true);
});
