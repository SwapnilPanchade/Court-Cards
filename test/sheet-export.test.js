import test from "node:test";
import assert from "node:assert/strict";
import { buildSheetExport, formatIst } from "../src/sheet-export.js";
import { applyCompletedPayments, calculateBalances } from "../src/settlement.js";

const HOUR = 3_600_000;
const start = Date.UTC(2026, 8, 14, 15, 17); // 20:47 IST

const sessions = [
  { id: "day-1", startedAt: start - 24 * HOUR, closedAt: start - 20 * HOUR },
  { id: "day-2", startedAt: start, closedAt: null }
];
const games = [
  {
    id: "G1", sessionId: "day-2", roomCode: "ABC12", recordedAt: start + HOUR, stakePaise: 500, winnerTeam: 0,
    teamA: ["Swapnil", "Pradeep"], teamB: ["Ajit", "Ajay"],
    details: {
      mode: "normal", auction: true, caller: "Swapnil", trump: "diamonds", tricks: [6, 3], court: false, roomScore: [1, 0],
      passedBy: [], contract: { team: 0, bid: 5, holder: "Swapnil", made: true, decision: "keep" },
      bids: [{ player: "Swapnil", action: "forced_bid", bid: 5 }, { player: "Ajit", action: "pass", bid: null }]
    }
  },
  {
    id: "G2", sessionId: "day-2", roomCode: "ABC12", recordedAt: start + 2 * HOUR, stakePaise: 1000, winnerTeam: 1,
    teamA: ["Swapnil", "Ajit"], teamB: ["Pradeep", "Ajay"], details: null
  }
];
const payments = [
  { id: "P1", sessionId: "day-2", from: "Ajit", to: "Swapnil", amountPaise: 500, payerConfirmed: 1, receiverConfirmed: 1, createdAt: start + 3 * HOUR, completedAt: start + 3 * HOUR, voidedAt: null, voidedBy: null },
  { id: "P2", sessionId: "day-2", from: "Ajit", to: "Pradeep", amountPaise: 500, payerConfirmed: 1, receiverConfirmed: 1, createdAt: start + 3 * HOUR, completedAt: start + 3 * HOUR, voidedAt: start + 4 * HOUR, voidedBy: "Pradeep" },
  { id: "P3", sessionId: "day-2", from: "Ajay", to: "Pradeep", amountPaise: 500, payerConfirmed: 1, receiverConfirmed: 0, createdAt: start + 5 * HOUR, completedAt: null, voidedAt: null, voidedBy: null }
];
const snapshot = {
  transfers: [{ from: "Ajay", to: "Pradeep", amountPaise: 500, confirmationId: "P3", payerConfirmed: true, receiverConfirmed: false }],
  balances: [{ name: "Swapnil", amountPaise: 0 }]
};

const exported = buildSheetExport({ sessions, games, payments, snapshot, exportedAt: start + 6 * HOUR });
const sheet = (name) => exported.sheets.find((item) => item.name === name);

test("times are shown in IST", () => {
  assert.equal(formatIst(start), "2026-09-14 20:47");
  assert.equal(formatIst(null), "");
});

test("games sheet has one labelled row per game with the round story", () => {
  const games = sheet("Games");
  const row = Object.fromEntries(games.headers.map((header, index) => [header, games.rows[0][index]]));
  assert.equal(games.rows.length, 2);
  assert.equal(row.Day, "Day 2 · 2026-09-14");
  assert.equal(row.Winner, "Team A");
  assert.equal(row.Winners, "Swapnil + Pradeep");
  assert.equal(row.Hukum, "♦ Diamonds");
  assert.equal(row["Hukum called by"], "Swapnil");
  assert.equal(row["Contract result"], "Made");
  assert.equal(row["Team A hands"], 6);
  assert.equal(row["Bids / passes"], "Swapnil opened 5, Ajit passed");
  // Older games without details keep the money columns and leave the story blank.
  assert.equal(games.rows[1][games.headers.indexOf("Hukum")], "");
  assert.equal(games.rows[1][games.headers.indexOf("Stake ₹ per player")], 10);
});

test("payments get a readable status", () => {
  const rows = sheet("Payments").rows;
  assert.deepEqual(rows.map((row) => row[7]), ["Completed", "Reset", "Waiting for receiver"]);
  assert.deepEqual(sheet("Settle now").rows, [["Ajay", "Pradeep", 5, "Yes", "No"]]);
});

test("summary formulas use the same sign rule as the app's balances", () => {
  const summary = sheet("Summary");
  const swapnilIndex = summary.rows.findIndex((row) => row[0] === "Swapnil");
  const sheetRow = swapnilIndex + 2;
  assert.equal(summary.rows[swapnilIndex][8], `=F${sheetRow}+G${sheetRow}-H${sheetRow}`);
  assert.match(summary.rows[swapnilIndex][9], /Day 2 · 2026-09-14/);
  assert.equal(summary.rows[summary.rows.findIndex((row) => row[0] === "Total")][8], "=SUM(I2:I10)");

  // Evaluate the formulas by hand from the data sheets and compare with settlement.js.
  const results = sheet("Player results").rows;
  const paymentRows = sheet("Payments").rows;
  const completed = payments.filter((payment) => payment.completedAt && !payment.voidedAt);
  const expected = applyCompletedPayments(calculateBalances(games), completed);
  for (const { name, amountPaise } of expected) {
    const net = results.filter((row) => row[3] === name).reduce((sum, row) => sum + row[6], 0);
    const paidOut = paymentRows.filter((row) => row[2] === name && row[7] === "Completed").reduce((sum, row) => sum + row[4], 0);
    const received = paymentRows.filter((row) => row[3] === name && row[7] === "Completed").reduce((sum, row) => sum + row[4], 0);
    assert.equal(net + paidOut - received, amountPaise / 100, name);
  }
});
