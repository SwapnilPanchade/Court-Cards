import test from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_IDS,
  TABLE_THEMES,
  botSeats,
  canRequestTeamSwitch,
  chooseRoomAvatar,
  chooseRoomTeam,
  createEmptyRoom,
  createRound,
  defaultAvatarForSeat,
  hasHumans,
  joinAsPlayer,
  leavePlayerSeat,
  makeBot,
  publicRoomInfo,
  recordRoundResult,
  requestTeamSwitch,
  respondTeamSwitch,
  roomView,
  transferHost,
  updateRoomSettings
} from "../src/room-logic.js";

function human(name, token = "t") {
  return { name, token, socketId: "s", avatarId: "jugaadu", bot: false };
}

test("leave in lobby frees the seat so another player can join", () => {
  const room = createEmptyRoom("ABC12", human("Host", "host"));
  room.players[1] = human("Guest", "guest");
  const result = leavePlayerSeat(room, 1, { randomUUID: () => "uuid-1" });
  assert.equal(result.destroyed, false);
  assert.equal(room.players[1], null);
  const joined = joinAsPlayer(room, {
    name: "New",
    socketId: "n",
    avatarId: "sher",
    randomUUID: () => "uuid-2"
  });
  assert.equal(joined.seat, 1);
  assert.equal(room.players[1].name, "New");
});

test("mid-round leave replaces the human with a bot", () => {
  const room = createEmptyRoom("ABC12", human("Host", "host"));
  room.players[1] = human("Guest", "guest");
  room.players[2] = human("P2", "p2");
  room.players[3] = human("P3", "p3");
  room.round = createRound(3, room.settings, () => 0.5);
  const result = leavePlayerSeat(room, 1, { randomUUID: () => "bot-1" });
  assert.equal(result.replacedWithBot, true);
  assert.equal(room.players[1].bot, true);
  assert.equal(hasHumans(room), true);
});

test("last human leaving destroys the room even if bots remain", () => {
  const room = createEmptyRoom("ABC12", human("Host", "host"));
  room.players[1] = makeBot(1, () => "b1");
  room.players[2] = makeBot(2, () => "b2");
  room.players[3] = makeBot(3, () => "b3");
  room.round = createRound(3, room.settings, () => 0.5);
  const result = leavePlayerSeat(room, 0, { randomUUID: () => "b0" });
  assert.equal(result.destroyed, true);
});

test("joiner can choose which bot seat to replace", () => {
  const room = createEmptyRoom("ABC12", human("Host", "host"));
  room.players[1] = makeBot(1, () => "b1");
  room.players[2] = makeBot(2, () => "b2");
  room.players[3] = makeBot(3, () => "b3");
  room.round = createRound(3, room.settings, () => 0.5);
  assert.deepEqual(botSeats(room), [1, 2, 3]);
  const joined = joinAsPlayer(room, {
    name: "Swap",
    replaceSeat: 2,
    socketId: "x",
    avatarId: "sher",
    randomUUID: () => "human-2"
  });
  assert.equal(joined.seat, 2);
  assert.equal(room.players[2].bot, false);
  assert.equal(room.players[2].name, "Swap");
  assert.equal(room.players[1].bot, true);
});

test("join without replaceSeat asks to choose a bot when no empty seats", () => {
  const room = createEmptyRoom("ABC12", human("Host", "host"));
  room.players[1] = makeBot(1, () => "b1");
  room.players[2] = makeBot(2, () => "b2");
  room.players[3] = makeBot(3, () => "b3");
  assert.throws(() => joinAsPlayer(room, { name: "X", socketId: "s", randomUUID: () => "t" }), (error) => {
    assert.equal(error.code, "CHOOSE_BOT");
    assert.equal(error.bots.length, 3);
    return true;
  });
});

test("team switch is allowed in lobby and between rounds, blocked mid-round", () => {
  const room = createEmptyRoom("ABC12", human("Host", "host"));
  room.players[1] = human("Opp", "opp");
  assert.equal(canRequestTeamSwitch(room), true);
  requestTeamSwitch(room, 0, 1);
  const accepted = respondTeamSwitch(room, 1, true);
  assert.equal(accepted.swapped, true);
  assert.equal(room.players[0].name, "Opp");
  assert.equal(room.players[1].name, "Host");
  assert.equal(room.hostSeat, 1);

  room.players = [human("A", "a"), human("B", "b"), human("C", "c"), human("D", "d")];
  room.hostSeat = 0;
  room.round = createRound(3, room.settings, () => 0.5);
  assert.equal(canRequestTeamSwitch(room), false);
  assert.throws(() => requestTeamSwitch(room, 0, 1), /mid-round/);

  room.round.phase = "round_over";
  assert.equal(canRequestTeamSwitch(room), true);
  requestTeamSwitch(room, 0, 1);
  respondTeamSwitch(room, 1, false);
  assert.equal(room.teamSwitchRequest, null);
});

test("host transfer moves ownership to another human", () => {
  const room = createEmptyRoom("ABC12", human("Host", "host"));
  room.players[2] = human("Mate", "mate");
  assert.equal(transferHost(room, 0, 2), 2);
  assert.equal(room.hostSeat, 2);
  assert.throws(() => transferHost(room, 0, 2), /Only the host/);
});

test("scores accumulate without closing the match", () => {
  const room = createEmptyRoom("ABC12", human("Host", "host"));
  for (let i = 0; i < 8; i += 1) {
    recordRoundResult(room, { winner: i % 2, resultRecorded: false });
  }
  assert.deepEqual(room.score, [4, 4]);
  assert.equal(room.matchWinner, null);
});

test("settings lock after the game starts", () => {
  const room = createEmptyRoom("ABC12", human("Host", "host"));
  updateRoomSettings(room, 0, { tableTheme: "neon", auctionMode: true });
  assert.equal(room.tableTheme, "neon");
  room.round = createRound(3, room.settings, () => 0.5);
  room.settingsLocked = true;
  assert.throws(() => updateRoomSettings(room, 0, { tableTheme: "noir" }), /cannot change/);
});

test("room view and public info expose bots and team switch flags", () => {
  const room = createEmptyRoom("ABC12", {
    name: "Host",
    token: "host",
    socketId: "s",
    avatarId: "sher"
  });
  room.players[1] = makeBot(1, () => "b1");
  const info = publicRoomInfo(room);
  assert.equal(info.bots[0].seat, 1);
  assert.deepEqual(info.emptySeats, [2, 3]);

  room.players[2] = human("P2", "p2");
  room.players[3] = human("P3", "p3");
  room.round = createRound(3, { ...room.settings, auctionMode: true }, () => 0.5);
  const view = roomView(room, { role: "player", seat: 0 });
  assert.equal(view.matchWinner, null);
  assert.equal(view.matchTarget, null);
  assert.equal(view.canTeamSwitch, false);
  assert.equal(view.players[0].avatarId, "sher");
  assert.deepEqual(view.options.avatarIds, AVATAR_IDS);
  assert.deepEqual(TABLE_THEMES.includes("gully"), true);
  assert.equal(defaultAvatarForSeat(0), AVATAR_IDS[0]);
});

test("team choice and avatars still work in lobby", () => {
  const host = human("Host", "host");
  const room = createEmptyRoom("ABC12", host);
  room.players[1] = makeBot(1, () => "b1");
  assert.equal(chooseRoomTeam(room, 0, "B"), 3);
  assert.equal(room.hostSeat, 3);
  assert.equal(chooseRoomAvatar(room, 3, "cool-aunty"), "cool-aunty");
});
