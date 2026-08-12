import { DurableObject } from "cloudflare:workers";
import {
  PLAYER_NAMES,
  STAKE_PAISE,
  normalizeRosterName,
  normalizeSettlementEntry,
  summarizeSettlement
} from "./settlement.js";

export class SettlementLedgerDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settlement_sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        closed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS settlement_games (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        room_code TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        stake_paise INTEGER NOT NULL,
        winner_team INTEGER NOT NULL,
        team_a TEXT NOT NULL,
        team_b TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES settlement_sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_settlement_games_session_time
        ON settlement_games(session_id, recorded_at DESC);
      CREATE TABLE IF NOT EXISTS settlement_payments (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        basis_key TEXT NOT NULL,
        from_player TEXT NOT NULL,
        to_player TEXT NOT NULL,
        amount_paise INTEGER NOT NULL,
        payer_confirmed INTEGER NOT NULL DEFAULT 0,
        receiver_confirmed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        voided_at INTEGER,
        voided_by TEXT,
        FOREIGN KEY (session_id) REFERENCES settlement_sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_settlement_payments_session
        ON settlement_payments(session_id, completed_at DESC, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_payments_open
        ON settlement_payments(session_id, basis_key, from_player, to_player, amount_paise)
        WHERE completed_at IS NULL AND voided_at IS NULL;
      INSERT OR IGNORE INTO _sql_schema_migrations (id, applied_at) VALUES (1, ${Date.now()});
      INSERT OR IGNORE INTO _sql_schema_migrations (id, applied_at) VALUES (2, ${Date.now()});
    `);
  }

  ensureOpenSession(now = Date.now()) {
    const current = this.sql.exec(
      "SELECT id, started_at AS startedAt FROM settlement_sessions WHERE closed_at IS NULL ORDER BY started_at DESC LIMIT 1"
    ).toArray()[0];
    if (current) return current;

    const session = { id: crypto.randomUUID(), startedAt: now };
    this.sql.exec(
      "INSERT INTO settlement_sessions (id, started_at, closed_at) VALUES (?, ?, NULL)",
      session.id,
      session.startedAt
    );
    return session;
  }

  async recordGame(rawEntry) {
    const entry = normalizeSettlementEntry(rawEntry);
    const existing = this.sql.exec("SELECT id FROM settlement_games WHERE id = ?", entry.id).toArray()[0];
    if (existing) return { created: false, id: entry.id };

    const session = this.ensureOpenSession(entry.recordedAt);
    this.sql.exec(
      `INSERT INTO settlement_games
        (id, session_id, room_code, recorded_at, stake_paise, winner_team, team_a, team_b)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      session.id,
      entry.roomCode,
      entry.recordedAt,
      entry.stakePaise,
      entry.winnerTeam,
      JSON.stringify(entry.teamA),
      JSON.stringify(entry.teamB)
    );
    return { created: true, id: entry.id };
  }

  readGames(sessionId) {
    return this.sql.exec(
      `SELECT id, room_code AS roomCode, recorded_at AS recordedAt,
        stake_paise AS stakePaise, winner_team AS winnerTeam, team_a AS teamA, team_b AS teamB
       FROM settlement_games WHERE session_id = ? ORDER BY recorded_at DESC`,
      sessionId
    ).toArray().map((row) => ({
      ...row,
      teamA: JSON.parse(row.teamA),
      teamB: JSON.parse(row.teamB)
    }));
  }

  readCompletedPayments(sessionId) {
    return this.sql.exec(
      `SELECT id, from_player AS "from", to_player AS "to", amount_paise AS amountPaise,
        completed_at AS completedAt
       FROM settlement_payments
       WHERE session_id = ? AND completed_at IS NOT NULL AND voided_at IS NULL
       ORDER BY completed_at DESC`,
      sessionId
    ).toArray();
  }

  basisKey(games, completedPayments) {
    return JSON.stringify([
      games.map((game) => game.id).sort(),
      completedPayments.map((payment) => payment.id).sort()
    ]);
  }

  getSnapshot() {
    const session = this.ensureOpenSession();
    const games = this.readGames(session.id);
    const completedPayments = this.readCompletedPayments(session.id);
    const summary = summarizeSettlement(games, PLAYER_NAMES, completedPayments);
    const basisKey = this.basisKey(games, completedPayments);
    const confirmations = this.sql.exec(
      `SELECT id, from_player AS "from", to_player AS "to", amount_paise AS amountPaise,
        payer_confirmed AS payerConfirmed, receiver_confirmed AS receiverConfirmed
       FROM settlement_payments
       WHERE session_id = ? AND basis_key = ? AND completed_at IS NULL AND voided_at IS NULL`,
      session.id,
      basisKey
    ).toArray();

    const transfers = summary.transfers.map((transfer) => {
      const confirmation = confirmations.find((item) => item.from === transfer.from
        && item.to === transfer.to
        && item.amountPaise === transfer.amountPaise);
      return {
        ...transfer,
        confirmationId: confirmation?.id || null,
        payerConfirmed: Boolean(confirmation?.payerConfirmed),
        receiverConfirmed: Boolean(confirmation?.receiverConfirmed)
      };
    });

    return {
      session,
      stakePaise: STAKE_PAISE,
      roster: PLAYER_NAMES,
      ...summary,
      transfers,
      completedPayments
    };
  }

  confirmSettlement(actorValue, rawTransfer = {}, now = Date.now()) {
    const actor = normalizeRosterName(actorValue);
    const from = normalizeRosterName(rawTransfer.from);
    const to = normalizeRosterName(rawTransfer.to);
    const amountPaise = Number(rawTransfer.amountPaise);
    if (typeof rawTransfer.confirmed !== "boolean") {
      throw new Error("Choose whether to confirm or reset your payment status.");
    }
    const confirmed = rawTransfer.confirmed;
    if (from === to || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new Error("Choose a valid settlement payment.");
    }
    if (actor !== from && actor !== to) {
      throw new Error("Only the payer or receiver can confirm this settlement.");
    }

    const snapshot = this.getSnapshot();
    const transfer = snapshot.transfers.find((item) => item.from === from
      && item.to === to
      && item.amountPaise === amountPaise);
    if (!transfer) throw new Error("This settlement is no longer current. Refresh the ledger.");

    const basisKey = this.basisKey(snapshot.games, snapshot.completedPayments);
    let payment = this.sql.exec(
      `SELECT id, payer_confirmed AS payerConfirmed, receiver_confirmed AS receiverConfirmed
       FROM settlement_payments
       WHERE session_id = ? AND basis_key = ? AND from_player = ? AND to_player = ?
         AND amount_paise = ? AND completed_at IS NULL AND voided_at IS NULL`,
      snapshot.session.id,
      basisKey,
      from,
      to,
      amountPaise
    ).toArray()[0];

    if (!payment) {
      if (!confirmed) throw new Error("There is no confirmation to reset.");
      payment = { id: crypto.randomUUID(), payerConfirmed: 0, receiverConfirmed: 0 };
      this.sql.exec(
        `INSERT INTO settlement_payments
          (id, session_id, basis_key, from_player, to_player, amount_paise,
           payer_confirmed, receiver_confirmed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        payment.id,
        snapshot.session.id,
        basisKey,
        from,
        to,
        amountPaise,
        now,
        now
      );
    }

    const field = actor === from ? "payer_confirmed" : "receiver_confirmed";
    this.sql.exec(
      `UPDATE settlement_payments SET ${field} = ?, updated_at = ? WHERE id = ?`,
      confirmed ? 1 : 0,
      now,
      payment.id
    );
    const updated = this.sql.exec(
      `SELECT payer_confirmed AS payerConfirmed, receiver_confirmed AS receiverConfirmed
       FROM settlement_payments WHERE id = ?`,
      payment.id
    ).one();
    if (updated.payerConfirmed && updated.receiverConfirmed) {
      this.sql.exec(
        "UPDATE settlement_payments SET completed_at = ?, updated_at = ? WHERE id = ? AND completed_at IS NULL",
        now,
        now,
        payment.id
      );
    }
    return this.getSnapshot();
  }

  resetSettlement(actorValue, paymentIdValue, now = Date.now()) {
    const actor = normalizeRosterName(actorValue);
    const paymentId = String(paymentIdValue || "").trim().slice(0, 120);
    const session = this.ensureOpenSession(now);
    const payment = this.sql.exec(
      `SELECT id, from_player AS "from", to_player AS "to"
       FROM settlement_payments
       WHERE id = ? AND session_id = ? AND completed_at IS NOT NULL AND voided_at IS NULL`,
      paymentId,
      session.id
    ).toArray()[0];
    if (!payment) throw new Error("This completed settlement was not found.");
    if (actor !== payment.from && actor !== payment.to) {
      throw new Error("Only the payer or receiver can reset this settlement.");
    }
    this.sql.exec(
      "UPDATE settlement_payments SET voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?",
      now,
      actor,
      now,
      payment.id
    );
    return this.getSnapshot();
  }

  startNewDay(now = Date.now()) {
    const snapshot = this.getSnapshot();
    if (snapshot.transfers.length || snapshot.balances.some((balance) => balance.amountPaise !== 0)) {
      throw new Error("Every payment needs both confirmations before starting a new day.");
    }
    const current = this.ensureOpenSession(now);
    this.sql.exec(
      "UPDATE settlement_sessions SET closed_at = ? WHERE id = ? AND closed_at IS NULL",
      now,
      current.id
    );
    this.ensureOpenSession(now + 1);
    return this.getSnapshot();
  }
}
