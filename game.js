const SUITS = ["clubs", "diamonds", "hearts", "spades"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const MODES = ["single", "double", "hidden"];
const DECK_SIZES = [52, 48, 44, 40, 36, 32, 28, 24, 20];

function createDeck(deckSize = 52) {
  if (!DECK_SIZES.includes(deckSize)) throw new Error("Deck size must be 20–52 cards in steps of four.");
  const ranks = RANKS.slice(RANKS.length - deckSize / 4);
  return SUITS.flatMap((suit) =>
    ranks.map((rank) => ({ id: `${rank}-${suit}`, suit, rank, value: RANKS.indexOf(rank) }))
  );
}

function shuffle(deck, random = Math.random) {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function dealHands(deck) {
  const hands = [[], [], [], []];
  deck.forEach((card, index) => hands[index % 4].push(card));
  return hands;
}

function teamForSeat(seat) {
  return seat % 2;
}

// Raw completed-trick wins. In Double/Hidden Sir this intentionally differs
// from `round.tricks`, which only counts bundles after the Sir condition lands.
function wonTricksByTeam(round) {
  const collected = round?.collectedBySeat;
  if (!Array.isArray(collected) || collected.length !== 4) throw new Error("Round trick collections are invalid.");
  return [collected[0] + collected[2], collected[1] + collected[3]];
}

function canPlayCard(hand, card, leadSuit) {
  if (!card || !hand.some((item) => item.id === card.id)) return false;
  if (!leadSuit || card.suit === leadSuit) return true;
  return !hand.some((item) => item.suit === leadSuit);
}

function winningPlay(plays, trump, trumpEffectiveFrom = 0) {
  if (!plays.length) return null;
  const leadSuit = plays[0].card.suit;
  return plays.reduce((winner, play, index) => {
    const winnerIndex = plays.indexOf(winner);
    const winnerTrump = winner.card.suit === trump && (leadSuit === trump || winnerIndex >= trumpEffectiveFrom);
    const playTrump = play.card.suit === trump && (leadSuit === trump || index >= trumpEffectiveFrom);
    if (playTrump !== winnerTrump) return playTrump ? play : winner;
    if (play.card.suit !== winner.card.suit) {
      return winner.card.suit === leadSuit ? winner : play;
    }
    return play.card.value > winner.card.value ? play : winner;
  });
}

function createRound(dealer, settings = {}, random = Math.random) {
  const deckSize = DECK_SIZES.includes(settings.deckSize) ? settings.deckSize : 52;
  const mode = MODES.includes(settings.mode) ? settings.mode : "single";
  const auctionMode = settings.auctionMode === true;
  const caller = (dealer + 1) % 4;
  const cardsPerPlayer = deckSize / 4;
  return {
    phase: auctionMode ? "bidding" : "choosing_trump",
    dealer,
    caller,
    mode,
    deckSize,
    cardsPerPlayer,
    auctionMode,
    bidState: auctionMode ? {
      openingSeat: caller,
      minimumBid: Math.floor(cardsPerPlayer / 2) + 1,
      maximumBid: cardsPerPlayer,
      highestBid: null,
      highestBidder: null,
      turn: caller,
      actedSeats: [],
      passedSeats: [],
      history: [],
      complete: false,
      decisionSeat: caller,
      decision: null,
      decisionReason: null,
      contractBid: null,
      contractTeam: null,
      contractMade: null
    } : null,
    trump: null,
    trumpCardId: null,
    trumpRevealed: mode !== "hidden",
    trumpEffectiveFrom: 0,
    mustTrumpSeat: null,
    hands: dealHands(shuffle(createDeck(deckSize), random)),
    turn: caller,
    trick: [],
    completedTricks: [],
    tricks: [0, 0],
    capturedBySeat: [0, 0, 0, 0],
    // Every completed trick is shown in the winner's on-table bundle. This is
    // deliberately separate from `capturedBySeat`, which is the scored bundle
    // in Sir modes and can stay at zero while a pool is still pending.
    collectedBySeat: [0, 0, 0, 0],
    pool: 0,
    lastTrickWinner: null,
    passedBy: [],
    pendingWinner: null,
    winner: null,
    court: false,
    resultRecorded: false
  };
}

function assertBiddingTurn(round, seat) {
  if (!round.auctionMode || round.phase !== "bidding" || !round.bidState) throw new Error("This round does not have an active auction.");
  if (round.bidState.turn !== seat) throw new Error("Wait for your bidding turn.");
  if (round.bidState.actedSeats.includes(seat)) throw new Error("You already acted in this auction.");
}

function finishAuctionAction(round, seat) {
  const bidState = round.bidState;
  bidState.actedSeats.push(seat);

  if (bidState.actedSeats.length < 4) {
    bidState.turn = (seat + 1) % 4;
    round.turn = bidState.turn;
    return round;
  }

  if (bidState.highestBidder === null) {
    bidState.highestBidder = bidState.openingSeat;
    bidState.highestBid = bidState.minimumBid;
    bidState.history.push({ seat: bidState.openingSeat, action: "forced_bid", bid: bidState.minimumBid });
    return finalizeAuction(round, bidState.openingSeat, "auto_keep", "all_pass");
  }

  bidState.turn = null;
  bidState.contractBid = bidState.highestBid;
  if (bidState.highestBidder === bidState.openingSeat) {
    return finalizeAuction(round, bidState.openingSeat, "auto_keep", "opening_highest");
  }

  round.turn = bidState.decisionSeat;
  round.phase = "auction_decision";
  return round;
}

function finalizeAuction(round, caller, decision, decisionReason = null) {
  const bidState = round.bidState;
  bidState.complete = true;
  bidState.decision = decision;
  bidState.decisionReason = decisionReason;
  bidState.contractBid = bidState.highestBid;
  bidState.contractTeam = teamForSeat(caller);
  round.caller = caller;
  round.turn = caller;
  round.phase = "choosing_trump";
  return round;
}

function decideAuction(round, seat, decision) {
  if (!round.auctionMode || round.phase !== "auction_decision" || !round.bidState) {
    throw new Error("There is no auction decision waiting.");
  }
  const bidState = round.bidState;
  if (seat !== bidState.decisionSeat) throw new Error("Only the original hukum caller can decide.");
  const normalizedDecision = String(decision || "").trim().toLowerCase();
  if (normalizedDecision !== "keep" && normalizedDecision !== "give") {
    throw new Error("Choose keep or give.");
  }
  if (bidState.highestBidder === null || bidState.highestBidder === bidState.openingSeat) {
    throw new Error("This auction does not need a decision.");
  }

  const caller = normalizedDecision === "keep" ? bidState.openingSeat : bidState.highestBidder;
  bidState.history.push({
    seat,
    action: normalizedDecision,
    bid: bidState.highestBid,
    awardedSeat: caller
  });
  return finalizeAuction(round, caller, normalizedDecision);
}

function placeBid(round, seat, value) {
  assertBiddingTurn(round, seat);
  const bid = Number(value);
  const bidState = round.bidState;
  const minimum = bidState.highestBid === null ? bidState.minimumBid : bidState.highestBid + 1;
  if (minimum > bidState.maximumBid) throw new Error("The maximum contract is already bid; pass.");
  if (!Number.isInteger(bid) || bid < minimum || bid > bidState.maximumBid) {
    throw new Error(`Bid ${minimum}–${bidState.maximumBid} tricks, or pass.`);
  }
  bidState.highestBid = bid;
  bidState.highestBidder = seat;
  bidState.history.push({ seat, action: "bid", bid });
  return finishAuctionAction(round, seat);
}

function passBid(round, seat) {
  assertBiddingTurn(round, seat);
  round.bidState.passedSeats.push(seat);
  round.bidState.history.push({ seat, action: "pass", bid: null });
  return finishAuctionAction(round, seat);
}

function passTrump(round, seat) {
  if (round.phase !== "choosing_trump") throw new Error("Hukum has already been chosen.");
  if (round.auctionMode) throw new Error("The auction winner must choose hukum.");
  if (seat !== round.caller) throw new Error("Only the current hukum caller can pass.");
  if (round.passedBy.length >= 3) throw new Error("Last caller must choose hukum.");
  round.passedBy.push(seat);
  round.caller = (seat + 1) % 4;
  round.turn = round.caller;
}

function chooseTrump(round, seat, suit) {
  if (round.phase !== "choosing_trump") throw new Error("Trump has already been chosen.");
  if (seat !== round.caller) throw new Error("Only the hukum caller can choose trump.");
  if (!SUITS.includes(suit)) throw new Error("Choose a valid suit.");
  round.trump = suit;
  round.phase = "playing";
}

function chooseHiddenTrump(round, seat, cardId) {
  if (round.phase !== "choosing_trump" || round.mode !== "hidden") throw new Error("Hidden hukum is not available.");
  if (seat !== round.caller) throw new Error("Only the hukum caller can choose trump.");
  const card = round.hands[seat].slice(0, 5).find((item) => item.id === cardId);
  if (!card) throw new Error("Choose one of your first five cards.");
  round.trump = card.suit;
  round.trumpCardId = card.id;
  round.trumpRevealed = false;
  round.phase = "playing";
}

function revealTrump(round, seat) {
  if (round.mode !== "hidden" || round.trumpRevealed) throw new Error("Hukum is already visible.");
  if (round.phase !== "playing" || round.turn !== seat) throw new Error("Hukum can only be revealed on your turn.");
  const leadSuit = round.trick[0]?.card.suit;
  const hand = round.hands[seat];
  const isCallerLead = seat === round.caller && !leadSuit;
  const isVoid = leadSuit && !hand.some((card) => card.suit === leadSuit);
  if (!isCallerLead && !isVoid) throw new Error("You can reveal hukum when leading as caller or when you cannot follow suit.");
  round.trumpRevealed = true;
  round.trumpEffectiveFrom = round.trick.length;
  if (hand.some((card) => card.suit === round.trump)) round.mustTrumpSeat = seat;
}

function playCard(round, seat, cardId) {
  if (round.phase !== "playing") throw new Error("The round is not ready for card play.");
  if (round.turn !== seat) throw new Error("Wait for your turn.");

  const hand = round.hands[seat];
  const card = hand.find((item) => item.id === cardId);
  const leadSuit = round.trick[0]?.card.suit;
  if (!canPlayCard(hand, card, leadSuit)) throw new Error(`You must follow ${leadSuit}.`);
  if (round.mustTrumpSeat === seat && card.suit !== round.trump) throw new Error("You revealed hukum, so you must play a trump.");

  round.hands[seat] = hand.filter((item) => item.id !== cardId);
  round.trick.push({ seat, card });
  round.mustTrumpSeat = null;
  round.turn = (seat + 1) % 4;

  if (round.trick.length === 4) {
    const effectiveTrump = round.mode === "hidden" && !round.trumpRevealed ? null : round.trump;
    const winner = winningPlay(round.trick, effectiveTrump, round.trumpEffectiveFrom);
    round.pendingWinner = winner.seat;
    round.phase = "trick_complete";
    round.turn = null;
  }

  return round;
}

function collectTrick(round) {
  if (round.phase !== "trick_complete" || round.trick.length !== 4) throw new Error("No completed trick to collect.");
  const winnerSeat = round.pendingWinner;
  const winner = round.trick.find((play) => play.seat === winnerSeat);
  if (!winner) throw new Error("Trick winner is missing.");
    const team = teamForSeat(winner.seat);
    round.collectedBySeat[winner.seat] += 1;
    round.pool += 1;

    if (round.mode === "single") {
      round.tricks[team] += 1;
      round.capturedBySeat[winner.seat] += 1;
      round.pool = 0;
    } else if (round.lastTrickWinner === winner.seat) {
      round.tricks[team] += round.pool;
      round.capturedBySeat[winner.seat] += round.pool;
      round.pool = 0;
      round.lastTrickWinner = null;
    } else {
      round.lastTrickWinner = winner.seat;
    }

    round.completedTricks.push({ plays: round.trick, winner: winner.seat });
    round.trick = [];
    round.pendingWinner = null;
    round.turn = winner.seat;
    round.phase = "playing";
    round.trumpEffectiveFrom = round.trumpRevealed ? 0 : Infinity;

    const isLastTrick = round.completedTricks.length === round.cardsPerPlayer;
    if (isLastTrick && round.pool > 0) {
      round.tricks[team] += round.pool;
      round.capturedBySeat[winner.seat] += round.pool;
      round.pool = 0;
    }

    // Finish the deal only after every card has been played. A majority can
    // decide the eventual winner, but cutting the deal short hides cards and
    // makes the final trick bundles confusing for the table.
    const shouldEnd = isLastTrick;
    if (shouldEnd) {
      round.phase = "round_over";
      if (round.auctionMode && round.bidState?.contractTeam !== null) {
        round.bidState.contractMade = round.tricks[round.bidState.contractTeam] >= round.bidState.contractBid;
        round.winner = round.bidState.contractMade ? round.bidState.contractTeam : 1 - round.bidState.contractTeam;
      } else {
        const callerTeam = teamForSeat(round.caller);
        const callerMadeMajority = round.tricks[callerTeam] > round.cardsPerPlayer / 2;
        round.winner = callerMadeMajority ? callerTeam : 1 - callerTeam;
      }
      round.court = round.mode === "single"
        ? round.tricks[1 - round.winner] === 0
        : round.tricks[round.winner] === round.cardsPerPlayer;
    }
  return round;
}

module.exports = {
  SUITS,
  RANKS,
  MODES,
  DECK_SIZES,
  createDeck,
  shuffle,
  dealHands,
  teamForSeat,
  wonTricksByTeam,
  canPlayCard,
  winningPlay,
  createRound,
  placeBid,
  passBid,
  decideAuction,
  chooseTrump,
  chooseHiddenTrump,
  passTrump,
  revealTrump,
  playCard,
  collectTrick
};
