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

test("a six-player table settles as two teams of three at ₹5 per player", () => {
  const room = {
    code: "SIX12",
    gameType: "court-piece",
    players: [
      player("Swapnil"), player("Ajit"), player("Pradeep"),
      player("Ajay"), player("Saurabh"), player("Rahul")
    ]
  };
  const settlement = createRoundSettlement(room, () => "six-1");
  assert.equal(settlement.eligible, true);
  const entry = settlementEntryForRound(room, { phase: "round_over", winner: 1, settlement }, 2_000);
  assert.deepEqual(entry.teamA, ["Swapnil", "Pradeep", "Saurabh"]); // even seats
  assert.deepEqual(entry.teamB, ["Ajit", "Ajay", "Rahul"]); // odd seats

  const summary = summarizeSettlement([entry]);
  const balances = Object.fromEntries(summary.balances.map((item) => [item.name, item.amountPaise]));
  // Team B won: each B member +₹5, each A member −₹5, and it nets to zero.
  assert.equal(balances.Ajit, STAKE_PAISE);
  assert.equal(balances.Swapnil, -STAKE_PAISE);
  assert.equal(summary.balances.reduce((sum, item) => sum + item.amountPaise, 0), 0);
});

test("stake is configurable per room and snapshotted into each entry", () => {
  const room = {
    code: "STK12",
    gameType: "court-piece",
    settings: { stakePaise: 2000, moneyEnabled: true },
    players: [player("Swapnil"), player("Ajit"), player("Pradeep"), player("Ajay")]
  };
  const settlement = createRoundSettlement(room, () => "stk-1");
  assert.equal(settlement.eligible, true);
  assert.equal(settlement.stakePaise, 2000);
  const entry = settlementEntryForRound(room, { phase: "round_over", winner: 0, settlement }, 1_000);
  assert.equal(entry.stakePaise, 2000); // ₹20, not the ₹5 default
  const balances = Object.fromEntries(summarizeSettlement([entry]).balances.map((i) => [i.name, i.amountPaise]));
  assert.equal(balances.Swapnil, 2000);
  assert.equal(balances.Ajit, -2000);
});

test("money can be turned off entirely for a room", () => {
  const room = {
    code: "OFF12",
    gameType: "court-piece",
    settings: { stakePaise: 500, moneyEnabled: false },
    players: [player("Swapnil"), player("Ajit"), player("Pradeep"), player("Ajay")]
  };
  const settlement = createRoundSettlement(room, () => "off-1");
  assert.equal(settlement.eligible, false);
  assert.equal(settlementEntryForRound(room, { phase: "round_over", winner: 0, settlement }), null);
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

test("ledger entries keep the round story: caller, bids, contract and hands", () => {
  const room = {
    code: "STORY",
    gameType: "court-piece",
    score: [3, 2],
    players: [player("Swapnil"), player("Ajit"), player("Pradeep"), player("Ajay")]
  };
  const settlement = createRoundSettlement(room, () => "story-1");
  const entry = settlementEntryForRound(room, {
    phase: "round_over",
    winner: 1,
    settlement,
    mode: "single",
    auctionMode: true,
    caller: 1,
    trump: "hearts",
    tricks: [4, 5],
    court: false,
    passedBy: [],
    bidState: {
      contractBid: 6,
      contractTeam: 1,
      contractMade: false,
      decision: "give",
      history: [
        { seat: 0, action: "forced_bid", bid: 5 },
        { seat: 1, action: "bid", bid: 6 },
        { seat: 2, action: "pass", bid: null },
        { seat: 0, action: "give", bid: 6 }
      ]
    }
  }, 3_000);

  assert.equal(entry.details.caller, "Ajit");
  assert.equal(entry.details.trump, "hearts");
  assert.equal(entry.details.auction, true);
  assert.deepEqual(entry.details.tricks, [4, 5]);
  assert.deepEqual(entry.details.roomScore, [3, 2]);
  assert.deepEqual(entry.details.contract, { team: 1, bid: 6, holder: "Ajit", made: false, decision: "give" });
  assert.deepEqual(entry.details.bids.map((item) => `${item.player}:${item.action}:${item.bid}`), [
    "Swapnil:forced_bid:5", "Ajit:bid:6", "Pradeep:pass:null", "Swapnil:give:6"
  ]);
  // Games recorded before details existed stay valid.
  assert.equal(summarizeSettlement([{ ...entry, details: undefined }]).games[0].details, null);
});
