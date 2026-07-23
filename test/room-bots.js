const { io } = require("socket.io-client");

const code = process.argv[2];
if (!code) throw new Error("Usage: node test/room-bots.js ROOM_CODE");

const bots = [1, 2, 3].map((number) => ({
  number,
  client: io("http://127.0.0.1:3000", { transports: ["websocket"] }),
  acting: false
}));

function action(client, event, payload = {}) {
  return new Promise((resolve, reject) => client.emit(event, payload, (result) => result?.ok ? resolve(result) : reject(new Error(result?.error))));
}

bots.forEach((bot) => {
  bot.client.on("connect", () => action(bot.client, "join_room", { code, name: `Bot ${bot.number}` })
    .then(() => console.log(`Bot ${bot.number} joined ${code}`))
    .catch((error) => console.error(error.message)));

  bot.client.on("room_state", (state) => {
    const round = state.round;
    if (!round || round.phase !== "playing" || round.turn !== state.you.seat || bot.acting) return;
    const leadSuit = round.trick[0]?.card.suit;
    const matching = round.hand.filter((card) => card.suit === leadSuit);
    const selected = matching[0] || round.hand[0];
    bot.acting = true;
    setTimeout(() => action(bot.client, "play_card", { cardId: selected.id })
      .catch((error) => console.error(error.message))
      .finally(() => { bot.acting = false; }), 450);
  });
});

process.on("SIGINT", () => {
  bots.forEach((bot) => bot.client.close());
  process.exit(0);
});
