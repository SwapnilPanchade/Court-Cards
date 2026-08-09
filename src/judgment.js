import {
  SUITS,
  createDeck,
  shuffle,
  dealHands,
  canPlayCard,
  winningPlay
} from "./game.js";

const PLAYER_COUNT = 4;
const CARDS_PER_PLAYER = 13;
const TRUMP = "spades";

function nextSeat(seat) {
  return (seat + 1) % PLAYER_COUNT;
}

function scoreCall(call, tricks) {
  if (tricks < call) return 0;
  return Number((call + (tricks - call) * 0.1).toFixed(1));
}

export function createJudgmentRound(dealer = 3, random = Math.random) {
  const caller = nextSeat(dealer);
  return {
    gameType: "judgment",
    phase: "calling",
    dealer,
    caller,
    turn: caller,
    trump: TRUMP,
    deckSize: 52,
    cardsPerPlayer: CARDS_PER_PLAYER,
    hands: dealHands(shuffle(createDeck(52), random)),
    calls: [null, null, null, null],
    trick: [],
    completedTricks: [],
    tricks: [0, 0, 0, 0],
    pendingWinner: null,
    roundScores: [0, 0, 0, 0],
    winner: null,
    resultRecorded: false
  };
}

export function placeJudgmentCall(round, seat, value) {
  if (round.phase !== "calling") throw new Error("Calls are already closed.");
  if (round.turn !== seat) throw new Error("Wait for your call turn.");
  if (round.calls[seat] !== null) throw new Error("You already called.");
  const call = Number(value);
  if (!Number.isInteger(call) || call < 1 || call > CARDS_PER_PLAYER) {
    throw new Error(`Call 1–${CARDS_PER_PLAYER} tricks.`);
  }
  round.calls[seat] = call;
  const next = nextSeat(seat);
  if (round.calls.every((item) => item !== null)) {
    round.phase = "playing";
    round.turn = round.caller;
  } else {
    round.turn = next;
  }
  return round;
}

export function playJudgmentCard(round, seat, cardId) {
  if (round.phase !== "playing") throw new Error("The round is not ready for card play.");
  if (round.turn !== seat) throw new Error("Wait for your turn.");
  const hand = round.hands[seat];
  const card = hand.find((item) => item.id === cardId);
  const leadSuit = round.trick[0]?.card.suit;
  if (!canPlayCard(hand, card, leadSuit)) throw new Error(`You must follow ${leadSuit}.`);

  round.hands[seat] = hand.filter((item) => item.id !== cardId);
  round.trick.push({ seat, card });
  round.turn = nextSeat(seat);

  if (round.trick.length === PLAYER_COUNT) {
    round.pendingWinner = winningPlay(round.trick, TRUMP).seat;
    round.phase = "trick_complete";
    round.turn = null;
  }
  return round;
}

export function collectJudgmentTrick(round) {
  if (round.phase !== "trick_complete" || round.trick.length !== PLAYER_COUNT) {
    throw new Error("No completed trick to collect.");
  }
  const winner = round.trick.find((play) => play.seat === round.pendingWinner);
  if (!winner) throw new Error("Trick winner is missing.");
  round.tricks[winner.seat] += 1;
  round.completedTricks.push({ plays: round.trick, winner: winner.seat });
  round.trick = [];
  round.pendingWinner = null;
  round.turn = winner.seat;
  round.phase = "playing";

  if (round.completedTricks.length === CARDS_PER_PLAYER) {
    round.roundScores = round.calls.map((call, seat) => scoreCall(call, round.tricks[seat]));
    round.winner = round.roundScores.reduce(
      (best, score, seat) => score > round.roundScores[best] ? seat : best,
      0
    );
    round.phase = "round_over";
    round.turn = null;
  }
  return round;
}

export function botJudgmentCall(round, seat) {
  const hand = round.hands[seat];
  const spades = hand.filter((card) => card.suit === TRUMP).length;
  const highCards = hand.filter((card) => card.value >= 11).length;
  return Math.max(1, Math.min(CARDS_PER_PLAYER, Math.round((spades * 0.65) + (highCards * 0.35))));
}

export function botJudgmentCard(round, seat) {
  const hand = round.hands[seat];
  const leadSuit = round.trick[0]?.card.suit;
  let legal = leadSuit ? hand.filter((card) => card.suit === leadSuit) : hand;
  if (!legal.length) legal = hand;
  return legal.slice().sort((a, b) => a.value - b.value)[0];
}

export function pickJudgmentTimeoutCard(round, seat, randomInt = (max) => Math.floor(Math.random() * max)) {
  const hand = round.hands[seat];
  const leadSuit = round.trick[0]?.card.suit;
  let legal = leadSuit ? hand.filter((card) => card.suit === leadSuit) : hand;
  if (!legal.length) legal = hand;
  return legal[randomInt(legal.length)];
}

export { PLAYER_COUNT, CARDS_PER_PLAYER, TRUMP, scoreCall };
