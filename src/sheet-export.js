import { PLAYER_NAMES } from "./settlement.js";

// Builds the Google Sheet tables for the money ledger. Pure: the ledger Durable
// Object reads SQLite and passes rows in; the Apps Script only writes what it gets.

const SUIT_LABELS = { spades: "♠ Spades", hearts: "♥ Hearts", diamonds: "♦ Diamonds", clubs: "♣ Clubs" };
const RUPEES = "₹#,##0;-₹#,##0;₹0";
const IST = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

export function formatIst(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const parts = Object.fromEntries(IST.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

const rupees = (paise) => Math.round(Number(paise) || 0) / 100;
const yesNo = (value) => (value ? "Yes" : "No");
const teamLabel = (team) => (team === 1 ? "Team B" : "Team A");

function bidText(item) {
  if (item.action === "pass") return `${item.player} passed`;
  if (item.action === "give") return `${item.player} gave it away`;
  if (item.action === "keep") return `${item.player} kept ${item.bid}`;
  if (item.action === "forced_bid") return `${item.player} opened ${item.bid}`;
  return `${item.player} bid ${item.bid}`;
}

function paymentStatus(payment, currentConfirmationIds) {
  if (payment.voidedAt) return "Reset";
  if (payment.completedAt) return "Completed";
  if (!currentConfirmationIds.has(payment.id)) return "Outdated";
  if (payment.payerConfirmed) return "Waiting for receiver";
  if (payment.receiverConfirmed) return "Waiting for payer";
  return "Waiting for both";
}

export function buildSheetExport({ sessions = [], games = [], payments = [], snapshot = null, roster = PLAYER_NAMES, exportedAt = Date.now() }) {
  const orderedSessions = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  const dayLabel = new Map(orderedSessions.map((session, index) => [session.id, `Day ${index + 1} · ${formatIst(session.startedAt).slice(0, 10)}`]));
  const openSession = orderedSessions.find((session) => !session.closedAt) || orderedSessions.at(-1);
  const today = openSession ? dayLabel.get(openSession.id) : "";
  const orderedGames = [...games].sort((a, b) => a.recordedAt - b.recordedAt);

  const gameRows = orderedGames.map((game) => {
    const details = game.details || null;
    const winners = game.winnerTeam === 0 ? game.teamA : game.teamB;
    const losers = game.winnerTeam === 0 ? game.teamB : game.teamA;
    const contract = details?.contract || null;
    return [
      game.id,
      dayLabel.get(game.sessionId) || "",
      formatIst(game.recordedAt),
      game.roomCode,
      rupees(game.stakePaise),
      teamLabel(game.winnerTeam),
      game.teamA.join(" + "),
      game.teamB.join(" + "),
      winners.join(" + "),
      losers.join(" + "),
      details ? SUIT_LABELS[details.trump] || "" : "",
      details?.caller || "",
      details ? (details.mode === "hidden" ? "Hidden" : "Normal") : "",
      details ? yesNo(details.auction) : "",
      contract ? contract.holder || teamLabel(contract.team) : "",
      contract ? contract.bid : "",
      contract ? (contract.made ? "Made" : "Failed") : "",
      details ? details.tricks[0] : "",
      details ? details.tricks[1] : "",
      details ? yesNo(details.court) : "",
      details?.roomScore ? details.roomScore[0] : "",
      details?.roomScore ? details.roomScore[1] : "",
      (details?.bids || []).map(bidText).join(", "),
      (details?.passedBy || []).join(", ")
    ];
  });

  const playerRows = orderedGames.flatMap((game) => [
    ...game.teamA.map((player) => [player, "Team A", game.winnerTeam === 0]),
    ...game.teamB.map((player) => [player, "Team B", game.winnerTeam === 1])
  ].map(([player, team, won]) => [
    game.id,
    dayLabel.get(game.sessionId) || "",
    formatIst(game.recordedAt),
    player,
    team,
    won ? "Won" : "Lost",
    won ? rupees(game.stakePaise) : -rupees(game.stakePaise)
  ]));

  const currentConfirmationIds = new Set((snapshot?.transfers || []).map((transfer) => transfer.confirmationId).filter(Boolean));
  const paymentRows = [...payments].sort((a, b) => a.createdAt - b.createdAt).map((payment) => [
    payment.id,
    dayLabel.get(payment.sessionId) || "",
    payment.from,
    payment.to,
    rupees(payment.amountPaise),
    yesNo(payment.payerConfirmed),
    yesNo(payment.receiverConfirmed),
    paymentStatus(payment, currentConfirmationIds),
    formatIst(payment.createdAt),
    formatIst(payment.completedAt),
    payment.voidedBy || "",
    formatIst(payment.voidedAt)
  ]);

  const transfers = snapshot?.transfers || [];
  const settleRows = transfers.length
    ? transfers.map((transfer) => [transfer.from, transfer.to, rupees(transfer.amountPaise), yesNo(transfer.payerConfirmed), yesNo(transfer.receiverConfirmed)])
    : [["Everyone is settled", "", "", "", ""]];

  const dayRows = orderedSessions.map((session) => [
    dayLabel.get(session.id),
    formatIst(session.startedAt),
    formatIst(session.closedAt),
    orderedGames.filter((game) => game.sessionId === session.id).length,
    session.closedAt ? "Archived" : "Open"
  ]);

  // Summary is formulas over the data sheets, so it recalculates inside Sheets.
  // Balance = net from games + paid out − received (+ gets money, − owes money).
  const appBalance = new Map((snapshot?.balances || []).map((balance) => [balance.name, rupees(balance.amountPaise)]));
  const R = "'Player results'";
  const summaryRows = roster.map((name, index) => {
    const r = index + 2;
    return [
      name,
      `=COUNTIF(${R}!D:D,A${r})`,
      `=COUNTIFS(${R}!D:D,A${r},${R}!F:F,"Won")`,
      `=B${r}-C${r}`,
      `=IF(B${r}=0,"",C${r}/B${r})`,
      `=SUMIF(${R}!D:D,A${r},${R}!G:G)`,
      `=SUMIFS(Payments!E:E,Payments!C:C,A${r},Payments!H:H,"Completed")`,
      `=SUMIFS(Payments!E:E,Payments!D:D,A${r},Payments!H:H,"Completed")`,
      `=F${r}+G${r}-H${r}`,
      `=SUMIFS(${R}!G:G,${R}!D:D,A${r},${R}!B:B,"${today}")`,
      appBalance.get(name) ?? 0
    ];
  });
  const last = roster.length + 1;
  summaryRows.push([
    "Total",
    `=SUM(B2:B${last})`,
    `=SUM(C2:C${last})`,
    `=SUM(D2:D${last})`,
    "",
    `=SUM(F2:F${last})`,
    `=SUM(G2:G${last})`,
    `=SUM(H2:H${last})`,
    `=SUM(I2:I${last})`,
    `=SUM(J2:J${last})`,
    `=SUM(K2:K${last})`
  ]);
  summaryRows.push([]);
  summaryRows.push([`Balance: + means the player should receive, − means they should pay. Today = ${today || "no games yet"}.`]);
  summaryRows.push([`Last synced (IST): ${formatIst(exportedAt)}`]);

  return {
    exportedAt: formatIst(exportedAt),
    sheets: [
      {
        name: "Summary",
        headers: ["Player", "Games", "Won", "Lost", "Win %", "Net from games ₹", "Paid out ₹", "Received ₹", "Balance ₹ (+ gets / − pays)", "Today net ₹", "App balance ₹ (check)"],
        rows: summaryRows,
        formats: { E: "0%", F: RUPEES, G: RUPEES, H: RUPEES, I: RUPEES, J: RUPEES, K: RUPEES }
      },
      {
        name: "Settle now",
        headers: ["From (pays)", "To (receives)", "Amount ₹", "Payer confirmed", "Receiver confirmed"],
        rows: settleRows,
        formats: { C: RUPEES }
      },
      {
        name: "Games",
        headers: [
          "Game ID", "Day", "Recorded at (IST)", "Room", "Stake ₹ per player", "Winner", "Team A", "Team B",
          "Winners", "Losers", "Hukum", "Hukum called by", "Hukum mode", "Auction", "Contract held by",
          "Contract (hands)", "Contract result", "Team A hands", "Team B hands", "Court (clean sweep)",
          "Room score A", "Room score B", "Bids / passes", "Passed hukum"
        ],
        rows: gameRows,
        formats: { E: RUPEES }
      },
      {
        name: "Player results",
        headers: ["Game ID", "Day", "Recorded at (IST)", "Player", "Team", "Result", "Amount ₹"],
        rows: playerRows,
        formats: { G: RUPEES }
      },
      {
        name: "Payments",
        headers: ["Payment ID", "Day", "From (pays)", "To (receives)", "Amount ₹", "Payer confirmed", "Receiver confirmed", "Status", "Created (IST)", "Completed (IST)", "Reset by", "Reset at (IST)"],
        rows: paymentRows,
        formats: { E: RUPEES }
      },
      {
        name: "Days",
        headers: ["Day", "Started (IST)", "Archived (IST)", "Games", "Status"],
        rows: dayRows,
        formats: {}
      }
    ]
  };
}
