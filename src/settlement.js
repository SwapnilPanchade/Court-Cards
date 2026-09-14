export const PLAYER_NAMES = Object.freeze([
  "Pradeep",
  "Swapnil",
  "Ajit",
  "Ajay",
  "Saurabh",
  "John",
  "James",
  "Rahul",
  "Nishant"
]);

export const STAKE_PAISE = 500; // Default ₹5 per player.
export const MIN_STAKE_PAISE = 100; // ₹1
export const MAX_STAKE_PAISE = 1_000_000; // ₹10,000

// A per-player stake is any whole rupee amount within the allowed range.
// Falls back to the ₹5 default when the value is missing or invalid.
export function normalizeStakePaise(value, fallback = STAKE_PAISE) {
  const paise = Math.round(Number(value));
  if (!Number.isSafeInteger(paise) || paise < MIN_STAKE_PAISE || paise > MAX_STAKE_PAISE || paise % 100 !== 0) {
    if (value === undefined || value === null || value === "") return fallback;
    throw new Error("Stake must be a whole rupee amount between ₹1 and ₹10,000.");
  }
  return paise;
}

const PLAYER_BY_KEY = new Map(PLAYER_NAMES.map((name) => [name.toLowerCase(), name]));

export function canonicalRosterName(value) {
  return PLAYER_BY_KEY.get(String(value || "").trim().toLowerCase()) || null;
}

export function normalizeRosterName(value) {
  const name = canonicalRosterName(value);
  if (!name) throw new Error("Choose your name from the player list.");
  return name;
}

export function assertApprovedHumanPlayers(players) {
  const names = (players || [])
    .filter((player) => player && !player.bot)
    .map((player) => normalizeRosterName(player.name));
  if (new Set(names).size !== names.length) {
    throw new Error("Each human player must use a different approved name.");
  }
  return names;
}

export function createRoundSettlement(room, randomUUID = () => crypto.randomUUID()) {
  const players = room.players.map((player) => {
    if (!player || player.bot) return null;
    return canonicalRosterName(player.name);
  });
  // Eligible when money tracking is on and every seat holds a distinct approved
  // human. Court Piece tables are 4 (2v2) or 6 (3v3).
  const moneyEnabled = room.settings?.moneyEnabled !== false;
  const eligible = room.gameType === "court-piece"
    && moneyEnabled
    && players.every(Boolean)
    && new Set(players).size === players.length
    && (players.length === 4 || players.length === 6);

  return {
    id: `${room.code}:${randomUUID()}`,
    eligible,
    // Snapshot the room's stake so later stake changes never rewrite past games.
    stakePaise: normalizeStakePaise(room.settings?.stakePaise),
    players
  };
}

export function settlementEntryForRound(room, round, recordedAt = Date.now()) {
  if (room.gameType !== "court-piece"
    || round?.phase !== "round_over"
    || !round.settlement?.eligible
    || (round.winner !== 0 && round.winner !== 1)) return null;

  const players = round.settlement.players;
  return normalizeSettlementEntry({
    id: round.settlement.id,
    roomCode: room.code,
    recordedAt,
    stakePaise: normalizeStakePaise(round.settlement.stakePaise),
    winnerTeam: round.winner,
    // Teams alternate by seat parity: A = even seats, B = odd seats.
    teamA: players.filter((_, seat) => seat % 2 === 0),
    teamB: players.filter((_, seat) => seat % 2 === 1),
    details: roundDetails(room, round, players)
  });
}

// What the round-end sheet showed, keyed by roster name so it survives seat swaps.
function roundDetails(room, round, players) {
  const bid = round.bidState;
  const hasContract = Boolean(round.auctionMode) && bid?.contractBid !== null && bid?.contractBid !== undefined;
  return {
    mode: round.mode,
    auction: Boolean(round.auctionMode),
    caller: players[round.caller],
    trump: round.trump,
    tricks: round.tricks,
    court: round.court,
    roomScore: room.score,
    passedBy: (round.passedBy || []).map((seat) => players[seat]),
    bids: (bid?.history || []).map((item) => ({ player: players[item.seat], action: item.action, bid: item.bid })),
    // After the auction, round.caller is whoever holds hukum and the contract.
    contract: hasContract
      ? { team: bid.contractTeam, bid: bid.contractBid, holder: players[round.caller], made: bid.contractMade, decision: bid.decision }
      : null
  };
}

const SUIT_NAMES = ["spades", "hearts", "diamonds", "clubs"];
const BID_ACTIONS = ["bid", "pass", "keep", "give", "forced_bid"];

function detailCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 10_000 ? number : null;
}

// Optional round story stored with each ledger game; older games have none.
export function normalizeSettlementDetails(raw) {
  if (!raw || typeof raw !== "object") return null;
  const contract = raw.contract && typeof raw.contract === "object" && detailCount(raw.contract.bid) !== null
    ? {
      team: raw.contract.team === 1 ? 1 : 0,
      bid: detailCount(raw.contract.bid),
      holder: canonicalRosterName(raw.contract.holder),
      made: Boolean(raw.contract.made),
      decision: /^[a-z_]{1,20}$/.test(String(raw.contract.decision || "")) ? raw.contract.decision : null
    }
    : null;
  return {
    mode: raw.mode === "hidden" ? "hidden" : "normal",
    auction: Boolean(raw.auction),
    caller: canonicalRosterName(raw.caller),
    trump: SUIT_NAMES.includes(raw.trump) ? raw.trump : null,
    tricks: [0, 1].map((team) => detailCount(raw.tricks?.[team]) ?? 0),
    court: Boolean(raw.court),
    roomScore: Array.isArray(raw.roomScore) ? [0, 1].map((team) => detailCount(raw.roomScore[team]) ?? 0) : null,
    passedBy: Array.isArray(raw.passedBy) ? raw.passedBy.map(canonicalRosterName).filter(Boolean).slice(0, 6) : [],
    bids: Array.isArray(raw.bids)
      ? raw.bids.slice(0, 16)
        .map((item) => ({ player: canonicalRosterName(item?.player), action: BID_ACTIONS.includes(item?.action) ? item.action : null, bid: detailCount(item?.bid) }))
        .filter((item) => item.player && item.action)
      : [],
    contract
  };
}

export function normalizeSettlementEntry(entry) {
  const id = String(entry?.id || "").trim().slice(0, 120);
  const roomCode = String(entry?.roomCode || "").trim().toUpperCase().slice(0, 12);
  const recordedAt = Number(entry?.recordedAt);
  const stakePaise = Number(entry?.stakePaise);
  const winnerTeam = Number(entry?.winnerTeam);
  const teamA = Array.isArray(entry?.teamA) ? entry.teamA.map(normalizeRosterName) : [];
  const teamB = Array.isArray(entry?.teamB) ? entry.teamB.map(normalizeRosterName) : [];
  const allPlayers = [...teamA, ...teamB];

  if (!id || !roomCode) throw new Error("Settlement identity is missing.");
  if (!Number.isSafeInteger(recordedAt) || recordedAt <= 0) throw new Error("Settlement time is invalid.");
  const normalizedStake = normalizeStakePaise(stakePaise, null);
  if (normalizedStake === null) throw new Error("Settlement stake is invalid.");
  if (winnerTeam !== 0 && winnerTeam !== 1) throw new Error("Settlement winner is invalid.");
  if (teamA.length !== teamB.length
    || (teamA.length !== 2 && teamA.length !== 3)
    || new Set(allPlayers).size !== allPlayers.length) {
    throw new Error("A settlement needs equal teams of two or three different approved players.");
  }

  return { id, roomCode, recordedAt, stakePaise: normalizedStake, winnerTeam, teamA, teamB, details: normalizeSettlementDetails(entry?.details) };
}

export function calculateBalances(games, roster = PLAYER_NAMES) {
  const balances = new Map(roster.map((name) => [name, 0]));

  for (const game of games) {
    const entry = normalizeSettlementEntry(game);
    const winners = entry.winnerTeam === 0 ? entry.teamA : entry.teamB;
    const losers = entry.winnerTeam === 0 ? entry.teamB : entry.teamA;
    winners.forEach((name) => balances.set(name, (balances.get(name) || 0) + entry.stakePaise));
    losers.forEach((name) => balances.set(name, (balances.get(name) || 0) - entry.stakePaise));
  }

  return Array.from(balances, ([name, amountPaise]) => ({ name, amountPaise }));
}

export function calculateTransfers(balances) {
  const debtors = balances
    .filter((balance) => balance.amountPaise < 0)
    .map((balance) => ({ name: balance.name, amountPaise: -balance.amountPaise }));
  const creditors = balances
    .filter((balance) => balance.amountPaise > 0)
    .map((balance) => ({ name: balance.name, amountPaise: balance.amountPaise }));
  const transfers = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountPaise = Math.min(debtor.amountPaise, creditor.amountPaise);
    transfers.push({ from: debtor.name, to: creditor.name, amountPaise });
    debtor.amountPaise -= amountPaise;
    creditor.amountPaise -= amountPaise;
    if (debtor.amountPaise === 0) debtorIndex += 1;
    if (creditor.amountPaise === 0) creditorIndex += 1;
  }

  return transfers;
}

export function applyCompletedPayments(balances, completedPayments = []) {
  const amounts = new Map(balances.map(({ name, amountPaise }) => [name, amountPaise]));

  for (const payment of completedPayments) {
    const from = normalizeRosterName(payment?.from);
    const to = normalizeRosterName(payment?.to);
    const amountPaise = Number(payment?.amountPaise);
    if (from === to || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new Error("Settlement payment is invalid.");
    }
    amounts.set(from, (amounts.get(from) || 0) + amountPaise);
    amounts.set(to, (amounts.get(to) || 0) - amountPaise);
  }

  return balances.map(({ name }) => ({ name, amountPaise: amounts.get(name) || 0 }));
}

export function summarizeSettlement(games, roster = PLAYER_NAMES, completedPayments = []) {
  const normalizedGames = games.map(normalizeSettlementEntry);
  const balances = applyCompletedPayments(calculateBalances(normalizedGames, roster), completedPayments);
  return {
    games: normalizedGames,
    balances,
    transfers: calculateTransfers(balances)
  };
}
