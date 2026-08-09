import { SUITS, RANKS, shuffle } from "./game.js";

const PLAYER_COUNT = 4;
const CARDS_PER_PLAYER = 13;

function makeRummyDeck(random = Math.random) {
  const cards = [];
  for (let copy = 0; copy < 2; copy += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({
          id: `${copy}-${rank}-${suit}`,
          suit,
          rank,
          value: RANKS.indexOf(rank)
        });
      }
    }
  }
  cards.push({ id: "joker-1", suit: "joker", rank: "JOKER", value: 0, joker: true });
  cards.push({ id: "joker-2", suit: "joker", rank: "JOKER", value: 0, joker: true });
  return shuffle(cards, random);
}

function cardPoints(card) {
  if (card.joker) return 0;
  if (["A", "K", "Q", "J", "10"].includes(card.rank)) return card.rank === "A" ? 10 : 10;
  return Number(card.rank);
}

function groupKind(cards) {
  const jokers = cards.filter((card) => card.joker);
  const natural = cards.filter((card) => !card.joker);
  if (cards.length < 3 || !natural.length) return null;

  const sameRank = natural.every((card) => card.rank === natural[0].rank)
    && new Set(natural.map((card) => card.suit)).size === natural.length
    && natural.length + jokers.length >= 3;
  if (sameRank) return { kind: "set", pure: false };

  const sameSuit = natural.every((card) => card.suit === natural[0].suit)
    && new Set(natural.map((card) => card.value)).size === natural.length;
  if (!sameSuit) return null;

  const values = natural.map((card) => card.value).sort((a, b) => a - b);
  const gaps = values.slice(1).reduce((total, value, index) => total + Math.max(0, value - values[index] - 1), 0);
  if (gaps > jokers.length) return null;
  return { kind: "sequence", pure: jokers.length === 0 };
}

function candidateGroups(hand) {
  const groups = [];
  const length = hand.length;
  for (let mask = 1; mask < (1 << length); mask += 1) {
    if (mask.toString(2).split("1").length - 1 < 3) continue;
    const cards = hand.filter((_, index) => mask & (1 << index));
    const result = groupKind(cards);
    if (result) groups.push({ mask, ...result });
  }
  return groups;
}

export function isValidRummyHand(hand) {
  if (hand.length !== CARDS_PER_PLAYER) return false;
  const groups = candidateGroups(hand);
  const byBit = Array.from({ length: hand.length }, () => []);
  groups.forEach((group) => {
    for (let index = 0; index < hand.length; index += 1) {
      if (group.mask & (1 << index)) byBit[index].push(group);
    }
  });
  const fullMask = (1 << hand.length) - 1;
  const memo = new Map();
  function solve(mask, sequences, pureSequences) {
    const key = `${mask}:${sequences}:${pureSequences}`;
    if (memo.has(key)) return memo.get(key);
    if (mask === fullMask) return sequences >= 2 && pureSequences >= 1;
    const first = hand.findIndex((_, index) => !(mask & (1 << index)));
    for (const group of byBit[first]) {
      if (group.mask & mask) continue;
      if (solve(mask | group.mask, sequences + (group.kind === "sequence" ? 1 : 0), pureSequences + (group.pure ? 1 : 0))) {
        memo.set(key, true);
        return true;
      }
    }
    memo.set(key, false);
    return false;
  }
  return solve(0, 0, 0);
}

function nextSeat(seat) {
  return (seat + 1) % PLAYER_COUNT;
}

export function createRummyRound(dealer = 3, random = Math.random) {
  const deck = makeRummyDeck(random);
  const hands = Array.from({ length: PLAYER_COUNT }, () => deck.splice(0, CARDS_PER_PLAYER));
  const starter = nextSeat(dealer);
  return {
    gameType: "rummy",
    phase: "playing",
    dealer,
    caller: starter,
    turn: starter,
    deckSize: deck.length + hands.flat().length,
    cardsPerPlayer: CARDS_PER_PLAYER,
    hands,
    stock: deck,
    discard: [deck.pop()],
    drawnThisTurn: false,
    trick: [],
    completedTricks: [],
    tricks: [0, 0, 0, 0],
    roundScores: [0, 0, 0, 0],
    pendingWinner: null,
    winner: null,
    resultRecorded: false
  };
}

export function drawRummyCard(round, seat, source = "stock") {
  if (round.phase !== "playing") throw new Error("The round is over.");
  if (round.turn !== seat) throw new Error("Wait for your turn.");
  if (round.drawnThisTurn) throw new Error("Discard before drawing again.");
  const pile = source === "discard" ? round.discard : round.stock;
  const card = source === "discard" ? pile[pile.length - 1] : pile.pop();
  if (!card) throw new Error("That pile is empty.");
  if (source === "discard") pile.pop();
  round.hands[seat].push(card);
  round.drawnThisTurn = true;
  return round;
}

export function discardRummyCard(round, seat, cardId) {
  if (round.phase !== "playing") throw new Error("The round is over.");
  if (round.turn !== seat) throw new Error("Wait for your turn.");
  if (!round.drawnThisTurn) throw new Error("Draw a card first.");
  if (round.hands[seat].length !== CARDS_PER_PLAYER + 1) throw new Error("Your hand is not ready to discard.");
  const card = round.hands[seat].find((item) => item.id === cardId);
  if (!card) throw new Error("Choose a card from your hand.");
  round.hands[seat] = round.hands[seat].filter((item) => item.id !== cardId);
  round.discard.push(card);
  round.drawnThisTurn = false;

  if (isValidRummyHand(round.hands[seat])) {
    round.winner = seat;
    round.roundScores = round.hands.map((hand, index) => index === seat ? 0 : Math.min(80, hand.reduce((sum, item) => sum + cardPoints(item), 0)));
    round.phase = "round_over";
    round.turn = null;
  } else {
    round.turn = nextSeat(seat);
  }
  return round;
}

export function botRummyDrawSource(round) {
  return round.discard.length && Math.random() > 0.35 ? "discard" : "stock";
}

export function botRummyDiscard(round, seat) {
  return round.hands[seat].slice().sort((a, b) => cardPoints(b) - cardPoints(a))[0];
}

export { PLAYER_COUNT, CARDS_PER_PLAYER, makeRummyDeck, cardPoints, groupKind };
