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

export const STAKE_PAISE = 500;

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
  const eligible = room.gameType === "court-piece"
    && players.every(Boolean)
    && new Set(players).size === 4;

  return {
    id: `${room.code}:${randomUUID()}`,
    eligible,
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
    stakePaise: STAKE_PAISE,
    winnerTeam: round.winner,
    teamA: [players[0], players[2]],
    teamB: [players[1], players[3]]
  });
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
  if (stakePaise !== STAKE_PAISE) throw new Error("Settlement stake must be ₹5 per player.");
  if (winnerTeam !== 0 && winnerTeam !== 1) throw new Error("Settlement winner is invalid.");
  if (teamA.length !== 2 || teamB.length !== 2 || new Set(allPlayers).size !== 4) {
    throw new Error("A settlement needs four different approved players.");
  }

  return { id, roomCode, recordedAt, stakePaise, winnerTeam, teamA, teamB };
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
