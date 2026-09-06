import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_NAMES,
  STAKE_PAISE,
  applyCompletedPayments,
  assertApprovedHumanPlayers,
  canonicalRosterName,
  createRoundSettlement,
  normalizeRosterName,
  settlementEntryForRound,
  summarizeSettlement
} from "../src/settlement.js";

function player(name, bot = false) {
  return { name, bot };
}

test("player names are restricted to the fixed nine-person roster", () => {
  assert.equal(PLAYER_NAMES.length, 9);
  assert.equal(canonicalRosterName(" swapnil "), "Swapnil");
  assert.equal(normalizeRosterName("PRADEEP"), "Pradeep");
  assert.throws(() => normalizeRosterName("Unknown"), /player list/);
  assert.deepEqual(assertApprovedHumanPlayers([player("Swapnil"), player("Pradeep"), player("Bot", true)]), ["Swapnil", "Pradeep"]);
  assert.throws(() => assertApprovedHumanPlayers([player("Swapnil"), player("swapnil")]), /different approved name/);
});

test("a Court Piece round snapshots teams and creates a ₹5-per-player entry", () => {
  const room = {
    code: "ABC12",
    gameType: "court-piece",
    players: [player("Swapnil"), player("Ajit"), player("Pradeep"), player("Ajay")]
  };
  const settlement = createRoundSettlement(room, () => "round-1");
  const entry = settlementEntryForRound(room, {
    phase: "round_over",
    winner: 0,
    settlement
  }, 1_000);

  assert.equal(entry.id, "ABC12:round-1");
  assert.equal(entry.stakePaise, STAKE_PAISE);
  assert.deepEqual(entry.teamA, ["Swapnil", "Pradeep"]);
  assert.deepEqual(entry.teamB, ["Ajit", "Ajay"]);
});

test("bot rounds and non-Court-Piece rounds do not affect money", () => {
  const botRoom = {
    code: "BOT12",
    gameType: "court-piece",
    players: [player("Swapnil"), player("Ajit", true), player("Pradeep"), player("Ajay")]
  };
  const botSettlement = createRoundSettlement(botRoom, () => "bot-round");
  assert.equal(botSettlement.eligible, false);
  assert.equal(settlementEntryForRound(botRoom, { phase: "round_over", winner: 0, settlement: botSettlement }), null);

  const judgmentRoom = { ...botRoom, gameType: "judgment", players: botRoom.players.map((item) => ({ ...item, bot: false })) };
  assert.equal(createRoundSettlement(judgmentRoom, () => "judgment-round").eligible, false);
});

test("changing teams between games is calculated per person and netted", () => {
  const games = [
    {
      id: "A:1", roomCode: "A", recordedAt: 1, stakePaise: 500, winnerTeam: 0,
      teamA: ["Swapnil", "Pradeep"], teamB: ["Ajit", "Ajay"]
    },
    {
      id: "A:2", roomCode: "A", recordedAt: 2, stakePaise: 500, winnerTeam: 1,
      teamA: ["Swapnil", "Ajit"], teamB: ["Pradeep", "Ajay"]
    }
  ];
  const summary = summarizeSettlement(games);
  const balances = Object.fromEntries(summary.balances.map((item) => [item.name, item.amountPaise]));

  assert.equal(balances.Swapnil, 0);
  assert.equal(balances.Pradeep, 1_000);
  assert.equal(balances.Ajit, -1_000);
  assert.equal(balances.Ajay, 0);
  assert.deepEqual(summary.transfers, [{ from: "Ajit", to: "Pradeep", amountPaise: 1_000 }]);
});

test("only completed bilateral payments reduce the live balance", () => {
  const balances = [
    { name: "Swapnil", amountPaise: -500 },
    { name: "Pradeep", amountPaise: 500 }
  ];
  assert.deepEqual(applyCompletedPayments(balances, []), balances);
  assert.deepEqual(applyCompletedPayments(balances, [{ from: "Swapnil", to: "Pradeep", amountPaise: 500 }]), [
    { name: "Swapnil", amountPaise: 0 },
    { name: "Pradeep", amountPaise: 0 }
  ]);
  assert.throws(() => applyCompletedPayments(balances, [{ from: "Swapnil", to: "Swapnil", amountPaise: 500 }]), /invalid/);
});
