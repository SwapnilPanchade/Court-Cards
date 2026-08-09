import {
  BOT_ACTION_DELAY_MS,
  COLLECTION_MS,
  TURN_TIMEOUT_MS,
  cleanName,
  createEmptyRoom,
  createRound,
  placeGameCall,
  playGameCard,
  collectGameTrick,
  decideAuction,
  chooseHiddenTrump,
  chooseRoomAvatar,
  chooseRoomTeam,
  chooseTrump,
  collectTrick,
  defaultAvatarForSeat,
  joinAsPlayer,
  kickPlayer,
  leavePlayerSeat,
  makeBot,
  humanIdleDeadline,
  isHumanIdle,
  markHumanActivity,
  normalizeAvatarId,
  passBid,
  passTrump,
  placeBid,
  playCard,
  publicRoomInfo,
  recordRoundResult,
  requestTeamSwitch,
  respondTeamSwitch,
  revealTrump,
  roomView,
  botAuctionDecision,
  botBid,
  botPlay,
  botJudgmentCall,
  botJudgmentCard,
  pickJudgmentTimeoutCard,
  botRummyDrawSource,
  botRummyDiscard,
  drawRummyCard,
  discardRummyCard,
  botTrump,
  isBot,
  pickTimeoutCard,
  transferHost,
  updateRoomSettings
} from "./room-logic.js";

const ROOM_KEY = "room";

export class RoomDurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;
  }

  async loadRoom() {
    if (this.room) return this.room;
    this.room = (await this.ctx.storage.get(ROOM_KEY)) || null;
    return this.room;
  }

  async saveRoom() {
    if (!this.room || this.room.destroyed) {
      await this.ctx.storage.delete(ROOM_KEY);
      await this.ctx.storage.deleteAlarm();
      this.room = null;
      return;
    }
    this.room.updatedAt = Date.now();
    await this.ctx.storage.put(ROOM_KEY, this.room);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    if (url.pathname === "/internal/create" && request.method === "POST") {
      return this.handleCreate(request);
    }

    if (url.pathname === "/internal/info" && request.method === "GET") {
      const room = await this.loadRoom();
      if (!room || room.destroyed) return Response.json({ ok: false, error: "Room not found." }, { status: 404 });
      return Response.json({ ok: true, ...publicRoomInfo(room) });
    }

    return new Response("Not found", { status: 404 });
  }

  async handleCreate(request) {
    const existing = await this.loadRoom();
    if (existing && !existing.destroyed) {
      return Response.json({ ok: false, error: "Room code already in use." }, { status: 409 });
    }

    const body = await request.json();
    const playerName = cleanName(body.name);
    if (!playerName) return Response.json({ ok: false, error: "Enter your name." }, { status: 400 });

    const code = String(body.code || "").trim().toUpperCase();
    const token = crypto.randomUUID();
    const host = {
      name: playerName,
      token,
      socketId: null,
      bot: false,
      avatarId: normalizeAvatarId(body.avatarId, defaultAvatarForSeat(0))
    };

    try {
      this.room = createEmptyRoom(code, host, {
        gameType: body.gameType,
        tableTheme: body.tableTheme,
        auctionMode: body.auctionMode
      });
      await this.saveRoom();
      await this.scheduleAfterStateChange();
      return Response.json({
        ok: true,
        code,
        token,
        gameType: this.room.gameType,
        tableTheme: this.room.tableTheme,
        auctionMode: this.room.settings.auctionMode,
        avatarId: host.avatarId
      });
    } catch (error) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
  }

  async handleWebSocket() {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let data;
    try {
      data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      ws.send(JSON.stringify({ ok: false, error: "Invalid message." }));
      return;
    }

    const { id, event, payload = {} } = data || {};
    try {
      const result = await this.dispatch(ws, event, payload);
      await this.recordHumanActivity(ws);
      if (id !== undefined) ws.send(JSON.stringify({ id, ok: true, ...result }));
    } catch (error) {
      const body = { id, ok: false, error: error.message || "Something went wrong." };
      if (error.code) body.code = error.code;
      if (error.bots) body.bots = error.bots;
      if (id !== undefined) ws.send(JSON.stringify(body));
    }
  }

  async webSocketClose(ws) {
    await this.detachSocket(ws, false);
  }

  async webSocketError(ws) {
    await this.detachSocket(ws, false);
  }

  async recordHumanActivity(ws) {
    const room = await this.loadRoom();
    if (!room || room.destroyed) return;
    const session = this.sessionOf(ws);
    const player = Number.isInteger(session.seat) ? room.players[session.seat] : null;
    const humanPlayer = session.role === "player" && player && !player.bot && player.token === session.token;
    const humanSpectator = session.role === "spectator"
      && room.spectators.some((spectator) => spectator.token === session.spectatorToken);
    if (!humanPlayer && !humanSpectator) return;
    markHumanActivity(room);
    await this.saveRoom();
    if (!room.alarm || room.alarm.kind === "idle") await this.scheduleAfterStateChange();
  }

  async detachSocket(ws, removePlayer) {
    const room = await this.loadRoom();
    if (!room) return;
    const attachment = ws.deserializeAttachment() || {};
    if (attachment.role === "spectator") {
      const spectator = room.spectators.find((item) => item.token === attachment.spectatorToken);
      if (removePlayer) room.spectators = room.spectators.filter((item) => item.token !== attachment.spectatorToken);
      else if (spectator) spectator.socketId = null;
    } else if (attachment.role === "player" && Number.isInteger(attachment.seat)) {
      const player = room.players[attachment.seat];
      if (player && !player.bot && player.token === attachment.token) {
        if (removePlayer) {
          const result = leavePlayerSeat(room, attachment.seat);
          if (result.destroyed) {
            room.destroyed = true;
            await this.saveRoom();
            this.broadcastDestroyed("no_humans");
            return;
          }
        } else {
          player.socketId = null;
        }
      }
    }
    await this.saveRoom();
    this.broadcast();
  }

  sessionOf(ws) {
    return ws.deserializeAttachment() || {};
  }

  requirePlayer(ws) {
    const session = this.sessionOf(ws);
    if (session.role !== "player" || !Number.isInteger(session.seat)) {
      throw new Error("Spectators cannot perform game actions.");
    }
    return session;
  }

  async dispatch(ws, event, payload) {
    switch (event) {
      case "join_room":
        return this.joinRoom(ws, payload);
      case "join_spectator":
        return this.joinSpectator(ws, payload);
      case "watch_player":
        return this.watchPlayer(ws, payload);
      case "leave_room":
        return this.leaveRoom(ws);
      case "start_game":
        return this.startGame(ws);
      case "fill_bots":
        return this.fillBots(ws);
      case "choose_team":
        return this.chooseTeam(ws, payload);
      case "choose_avatar":
        return this.chooseAvatar(ws, payload);
      case "update_settings":
        return this.updateSettings(ws, payload);
      case "request_team_switch":
        return this.requestSwitch(ws, payload);
      case "respond_team_switch":
        return this.respondSwitch(ws, payload);
      case "transfer_host":
        return this.doTransferHost(ws, payload);
      case "kick_player":
        return this.doKickPlayer(ws, payload);
      case "place_bid":
        return this.doPlaceBid(ws, payload);
      case "place_call":
        return this.doPlaceCall(ws, payload);
      case "pass_bid":
        return this.doPassBid(ws);
      case "decide_auction":
        return this.doDecideAuction(ws, payload);
      case "choose_trump":
        return this.doChooseTrump(ws, payload);
      case "pass_trump":
        return this.doPassTrump(ws);
      case "choose_hidden_trump":
        return this.doChooseHiddenTrump(ws, payload);
      case "reveal_trump":
        return this.doRevealTrump(ws);
      case "play_card":
        return this.doPlayCard(ws, payload);
      case "draw_card":
        return this.doDrawCard(ws, payload);
      case "discard_card":
        return this.doDiscardCard(ws, payload);
      case "next_round":
        return this.nextRound(ws);
      case "request_restart":
        return this.requestRestart(ws);
      case "respond_restart":
        return this.respondRestart(ws, payload);
      default:
        throw new Error("Unknown event.");
    }
  }

  async joinRoom(ws, payload) {
    const room = await this.loadRoom();
    if (!room || room.destroyed) throw new Error("Room not found. Check the code.");

    const connectionId = crypto.randomUUID();
    const result = joinAsPlayer(room, {
      name: payload.name,
      token: payload.token,
      avatarId: payload.avatarId,
      replaceSeat: payload.replaceSeat,
      socketId: connectionId
    });

    ws.serializeAttachment({
      role: "player",
      seat: result.seat,
      token: result.token,
      connectionId
    });
    await this.saveRoom();
    this.broadcast();
    if (room.round) await this.scheduleAfterStateChange();
    return {
      code: room.code,
      token: result.token,
      seat: result.seat,
      avatarId: result.avatarId
    };
  }

  async joinSpectator(ws, payload) {
    const room = await this.loadRoom();
    if (!room || room.destroyed) throw new Error("Room not found. Check the code.");

    let spectator = payload.token
      ? room.spectators.find((item) => item.token === payload.token)
      : null;
    if (!spectator) {
      const spectatorName = cleanName(payload.name);
      if (!spectatorName) throw new Error("Enter your name.");
      if (room.spectators.length >= 20) throw new Error("Spectator seats are full.");
      spectator = {
        name: spectatorName,
        token: crypto.randomUUID(),
        socketId: crypto.randomUUID(),
        watchingSeat: 0
      };
      room.spectators.push(spectator);
    } else {
      spectator.socketId = crypto.randomUUID();
    }

    ws.serializeAttachment({
      role: "spectator",
      spectatorToken: spectator.token,
      connectionId: spectator.socketId
    });
    await this.saveRoom();
    this.broadcast();
    return { code: room.code, token: spectator.token, role: "spectator" };
  }

  async watchPlayer(ws, payload) {
    const session = this.sessionOf(ws);
    if (session.role !== "spectator") throw new Error("Only spectators choose a player to follow.");
    const room = await this.loadRoom();
    const numericSeat = Number(payload.seat);
    if (!room?.players[numericSeat]) throw new Error("Choose an active player.");
    const spectator = room.spectators.find((item) => item.token === session.spectatorToken);
    if (!spectator) throw new Error("Spectator session not found.");
    spectator.watchingSeat = numericSeat;
    await this.saveRoom();
    this.broadcast();
    return {};
  }

  async leaveRoom(ws) {
    const room = await this.loadRoom();
    if (!room) return {};
    const session = this.sessionOf(ws);
    if (session.role === "spectator") {
      room.spectators = room.spectators.filter((item) => item.token !== session.spectatorToken);
      ws.serializeAttachment({ role: null });
      await this.saveRoom();
      this.broadcast();
      return {};
    }
    if (session.role === "player" && Number.isInteger(session.seat)) {
      const result = leavePlayerSeat(room, session.seat);
      ws.serializeAttachment({ role: null });
      if (result.destroyed) {
        room.destroyed = true;
        await this.saveRoom();
        this.broadcastDestroyed("no_humans");
        return { destroyed: true };
      }
      await this.saveRoom();
      this.broadcast();
      if (room.round) await this.scheduleAfterStateChange();
    }
    return {};
  }

  async startGame(ws) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room) throw new Error("Join a room first.");
    if (session.seat !== room.hostSeat) throw new Error("Only the host can start.");
    if (room.players.some((player) => !player)) throw new Error("Four players are required.");
    if (room.round && room.round.phase !== "round_over") throw new Error("A round is already active.");
    room.round = createRound(room.dealer, room.settings);
    room.settingsLocked = true;
    room.teamSwitchRequest = null;
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async fillBots(ws) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room) throw new Error("Join a room first.");
    if (session.seat !== room.hostSeat) throw new Error("Only the host can add bots.");
    if (room.round) throw new Error("Bots can only be added before the game starts.");
    room.players = room.players.map((player, index) => player || makeBot(index));
    await this.saveRoom();
    this.broadcast();
    return {};
  }

  async chooseTeam(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room) throw new Error("Join a room first.");
    const newSeat = chooseRoomTeam(room, session.seat, payload.team);
    ws.serializeAttachment({ ...session, seat: newSeat });
    await this.saveRoom();
    this.broadcast();
    return { seat: newSeat, team: newSeat % 2 };
  }

  async chooseAvatar(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room) throw new Error("Join a room first.");
    const avatarId = chooseRoomAvatar(room, session.seat, payload.avatarId);
    await this.saveRoom();
    this.broadcast();
    return { avatarId };
  }

  async updateSettings(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room) throw new Error("Join a room first.");
    updateRoomSettings(room, session.seat, payload);
    await this.saveRoom();
    this.broadcast();
    return {};
  }

  async requestSwitch(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room) throw new Error("Join a room first.");
    requestTeamSwitch(room, session.seat, Number(payload.targetSeat));
    await this.saveRoom();
    this.broadcast();
    return {};
  }

  async respondSwitch(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room) throw new Error("Join a room first.");
    const result = respondTeamSwitch(room, session.seat, Boolean(payload.accept));
    if (result.swapped) {
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() || {};
        if (attachment.role !== "player" || !attachment.token) continue;
        const seat = room.players.findIndex((player) => player && !player.bot && player.token === attachment.token);
        if (seat >= 0) socket.serializeAttachment({ ...attachment, seat });
      }
    }
    await this.saveRoom();
    this.broadcast();
    return result;
  }

  async doTransferHost(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room) throw new Error("Join a room first.");
    const hostSeat = transferHost(room, session.seat, Number(payload.seat));
    await this.saveRoom();
    this.broadcast();
    return { hostSeat };
  }

  async doKickPlayer(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room) throw new Error("Join a room first.");
    const result = kickPlayer(room, session.seat, Number(payload.seat));

    if (result.removedToken) {
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() || {};
        if (attachment.role !== "player" || attachment.token !== result.removedToken) continue;
        try { socket.send(JSON.stringify({ event: "kicked", payload: { reason: "The host removed you from the table." } })); } catch (_) { /* socket may already be closed */ }
        socket.serializeAttachment({ role: null });
        try { socket.close(1000, "Removed by host"); } catch (_) { /* socket may already be closed */ }
      }
    }

    await this.saveRoom();
    this.broadcast();
    if (room.round) await this.scheduleAfterStateChange();
    return { seat: result.seat, replacedWithBot: result.replacedWithBot };
  }

  async doPlaceBid(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round) throw new Error("No active round.");
    placeBid(room.round, session.seat, payload.bid);
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async doPlaceCall(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round) throw new Error("No active round.");
    placeGameCall(room.round, session.seat, payload.call);
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async doPassBid(ws) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round) throw new Error("No active round.");
    passBid(room.round, session.seat);
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async doDecideAuction(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round) throw new Error("No active round.");
    decideAuction(room.round, session.seat, payload.decision);
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async doChooseTrump(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round) throw new Error("No active round.");
    if (room.round.mode === "hidden") throw new Error("Choose a card for hidden hukum.");
    chooseTrump(room.round, session.seat, payload.suit);
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async doPassTrump(ws) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round) throw new Error("No active round.");
    passTrump(room.round, session.seat);
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async doChooseHiddenTrump(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round) throw new Error("No active round.");
    chooseHiddenTrump(room.round, session.seat, payload.cardId);
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async doRevealTrump(ws) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round) throw new Error("No active round.");
    revealTrump(room.round, session.seat);
    await this.saveRoom();
    this.broadcast();
    return {};
  }

  async doPlayCard(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round) throw new Error("No active round.");
    playGameCard(room.round, session.seat, payload.cardId);
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async doDrawCard(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round || room.gameType !== "rummy") throw new Error("Rummy is not active.");
    drawRummyCard(room.round, session.seat, payload.source || "stock");
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async doDiscardCard(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round || room.gameType !== "rummy") throw new Error("Rummy is not active.");
    discardRummyCard(room.round, session.seat, payload.cardId);
    if (room.round.phase === "round_over") recordRoundResult(room, room.round);
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async nextRound(ws) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round || room.round.phase !== "round_over") throw new Error("Finish the current round first.");
    if (session.seat !== room.hostSeat) throw new Error("Only the host can start the next round.");
    room.dealer = (room.dealer + 1) % 4;
    room.round = createRound(room.dealer, room.settings);
    room.restartVote = null;
    room.teamSwitchRequest = null;
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async requestRestart(ws) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.round) throw new Error("Start a game first.");
    if (room.restartVote) throw new Error("A restart vote is already active.");
    room.restartVote = { requesterSeat: session.seat, approvals: [session.seat] };
    room.players.forEach((player, index) => {
      if (player?.bot && !room.restartVote.approvals.includes(index)) room.restartVote.approvals.push(index);
    });
    if (room.restartVote.approvals.length === 4) await this.applyRestart(room);
    await this.saveRoom();
    this.broadcast();
    if (room.round && room.round.phase !== "round_over") await this.scheduleAfterStateChange();
    return {};
  }

  async respondRestart(ws, payload) {
    const session = this.requirePlayer(ws);
    const room = await this.loadRoom();
    if (!room?.restartVote) throw new Error("No restart vote is active.");
    if (!payload.accept) {
      room.restartVote = null;
      await this.saveRoom();
      this.broadcast();
      return {};
    }
    if (!room.restartVote.approvals.includes(session.seat)) room.restartVote.approvals.push(session.seat);
    if (room.restartVote.approvals.length === 4) await this.applyRestart(room);
    await this.saveRoom();
    this.broadcast();
    await this.scheduleAfterStateChange();
    return {};
  }

  async applyRestart(room) {
    // Fresh deal only — lifetime room scores are preserved.
    room.restartVote = null;
    room.teamSwitchRequest = null;
    room.dealer = (room.dealer + 1) % 4;
    room.round = createRound(room.dealer, room.settings);
    room.alarm = null;
    await this.ctx.storage.deleteAlarm();
  }

  broadcast() {
    if (!this.room || this.room.destroyed) return;
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() || {};
      try {
        if (attachment.role === "player" && Number.isInteger(attachment.seat)) {
          const player = this.room.players[attachment.seat];
          if (!player || player.bot || player.token !== attachment.token) continue;
          ws.send(JSON.stringify({
            event: "room_state",
            payload: roomView(this.room, { role: "player", seat: attachment.seat })
          }));
        } else if (attachment.role === "spectator") {
          const spectator = this.room.spectators.find((item) => item.token === attachment.spectatorToken);
          if (!spectator) continue;
          ws.send(JSON.stringify({
            event: "room_state",
            payload: roomView(this.room, { role: "spectator", spectator })
          }));
        }
      } catch {
        // Ignore sockets that closed mid-broadcast.
      }
    }
  }

  broadcastDestroyed(reason = "no_humans") {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ event: "room_destroyed", payload: { reason } }));
        ws.close(1000, "Room closed");
      } catch {
        // ignore
      }
    }
  }

  clearAlarmState(room) {
    room.alarm = null;
    if (room.round) room.round.turnDeadline = null;
  }

  async scheduleIdleAlarm(room = this.room) {
    if (!room || room.destroyed) return;
    room.alarm = { kind: "idle" };
    if (room.round) room.round.turnDeadline = null;
    await this.ctx.storage.put(ROOM_KEY, room);
    await this.ctx.storage.setAlarm(humanIdleDeadline(room));
  }

  async destroyIdleRoom(room) {
    room.destroyed = true;
    await this.saveRoom();
    this.broadcastDestroyed("human_inactivity");
  }

  async scheduleAfterStateChange() {
    const room = this.room;
    if (!room || room.destroyed) return;
    if (!room.round) {
      await this.scheduleIdleAlarm(room);
      return;
    }
    const round = room.round;
    if (round.phase === "trick_complete") {
      room.alarm = { kind: "collect" };
      round.turnDeadline = null;
      await this.ctx.storage.put(ROOM_KEY, room);
      await this.ctx.storage.setAlarm(Date.now() + COLLECTION_MS);
      return;
    }

    const botSeat = round.phase === "calling" ? round.turn
      : round.phase === "bidding" ? round.bidState?.turn
      : round.phase === "auction_decision" ? round.bidState?.decisionSeat
        : round.phase === "choosing_trump" ? round.caller
          : round.phase === "playing" ? round.turn : null;

    if (botSeat !== null && botSeat !== undefined && isBot(room, botSeat)) {
      room.alarm = { kind: "bot", seat: botSeat };
      round.turnDeadline = null;
      await this.ctx.storage.put(ROOM_KEY, room);
      await this.ctx.storage.setAlarm(Date.now() + BOT_ACTION_DELAY_MS);
      return;
    }

    if (round.phase === "playing" && round.turn !== null) {
      room.alarm = { kind: "turn", seat: round.turn };
      round.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
      await this.ctx.storage.put(ROOM_KEY, room);
      await this.ctx.storage.setAlarm(Date.now() + TURN_TIMEOUT_MS);
      this.broadcast();
      return;
    }

    this.clearAlarmState(room);
    await this.scheduleIdleAlarm(room);
  }

  async alarm() {
    const room = await this.loadRoom();
    if (!room || !room.alarm) return;
    const alarm = room.alarm;

    if (isHumanIdle(room)) {
      await this.destroyIdleRoom(room);
      return;
    }

    if (alarm.kind === "idle") {
      await this.scheduleIdleAlarm(room);
      return;
    }

    if (!room.round) {
      await this.scheduleIdleAlarm(room);
      return;
    }
    const round = room.round;

    if (alarm.kind === "collect") {
      if (round.phase !== "trick_complete") return;
      collectGameTrick(round);
      if (round.phase === "round_over") recordRoundResult(room, round);
      room.alarm = null;
      await this.saveRoom();
      this.broadcast();
      await this.scheduleAfterStateChange();
      return;
    }

    if (alarm.kind === "bot") {
      const botSeat = alarm.seat;
      if (!isBot(room, botSeat)) return;
      if (round.gameType === "judgment" && round.phase === "calling" && round.turn === botSeat) {
        placeGameCall(round, botSeat, botJudgmentCall(round, botSeat));
      } else if (round.gameType === "judgment" && round.phase === "playing" && round.turn === botSeat) {
        playGameCard(round, botSeat, botJudgmentCard(round, botSeat).id);
      } else if (round.gameType === "rummy" && round.phase === "playing" && round.turn === botSeat) {
        if (!round.drawnThisTurn) drawRummyCard(round, botSeat, botRummyDrawSource(round));
        else discardRummyCard(round, botSeat, botRummyDiscard(round, botSeat).id);
      } else if (round.phase === "bidding" && round.bidState?.turn === botSeat) {
        const bid = botBid(round, botSeat);
        if (bid === null) passBid(round, botSeat);
        else placeBid(round, botSeat, bid);
      } else if (round.phase === "auction_decision" && round.bidState?.decisionSeat === botSeat) {
        decideAuction(round, botSeat, botAuctionDecision(round, botSeat));
      } else if (round.phase === "choosing_trump" && round.caller === botSeat) {
        if (round.mode === "hidden") chooseHiddenTrump(round, botSeat, round.hands[botSeat][0].id);
        else chooseTrump(round, botSeat, botTrump(round, botSeat));
      } else if (round.phase === "playing" && round.turn === botSeat) {
        const card = botPlay(round, botSeat);
        playGameCard(round, botSeat, card.id);
      } else {
        room.alarm = null;
        await this.saveRoom();
        return;
      }
      room.alarm = null;
      await this.saveRoom();
      this.broadcast();
      await this.scheduleAfterStateChange();
      return;
    }

    if (alarm.kind === "turn") {
      const expectedSeat = alarm.seat;
      if (round.turn !== expectedSeat || isBot(room, expectedSeat)) return;
      if (round.gameType === "judgment" && round.phase === "calling") {
        placeGameCall(round, expectedSeat, botJudgmentCall(round, expectedSeat));
      } else if (round.gameType === "judgment" && round.phase === "playing") {
        const selected = pickJudgmentTimeoutCard(round, expectedSeat);
        playGameCard(round, expectedSeat, selected.id);
      } else if (round.gameType === "rummy" && round.phase === "playing") {
        if (!round.drawnThisTurn) drawRummyCard(round, expectedSeat, "stock");
        else discardRummyCard(round, expectedSeat, botRummyDiscard(round, expectedSeat).id);
      } else if (round.phase === "playing") {
        const selected = pickTimeoutCard(round, expectedSeat);
        playGameCard(round, expectedSeat, selected.id);
      } else return;
      if (round.phase === "round_over") recordRoundResult(room, round);
      room.alarm = null;
      await this.saveRoom();
      this.broadcast();
      await this.scheduleAfterStateChange();
    }
  }
}
