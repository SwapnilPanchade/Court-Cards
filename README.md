# Court Piece Online

A private-room, mobile-friendly Court Piece / Hokm game for friends or bots.

## Highlights

- Play with four friends, or fill any empty seats with server-controlled bots.
- One Express + Socket.IO process serves both the frontend and the real-time game backend.
- Choose Team A or Team B before the deal; partners still sit opposite each other.
- Host-configurable deck size, Normal or Hidden Hukum, and optional Auction Hukum.
- Five table themes: Noir, Comic, 2088 (`neon`), Adda, and Gully.
- Ten room-scoped comic avatars, including four women; bots receive distinct avatars too.
- Event-driven card, hukum-cut, trick, Court, deal, and match effects, with separate Sound and FX controls.
- Responsive table designed for mobile landscape, with a fully usable portrait fallback and desktop layout.

## Current rules

- Four players in two fixed seat pairs: seats 1 and 3 form Team A; seats 2 and 4 form Team B. Before play, a human can deliberately choose either team while it has an empty or bot-held seat.
- Host-selectable decks from 20 to 52 cards in steps of four. A 36-card deck uses 6–A and deals 9 cards each.
- Normal Hukum and Hidden Hukum modes. Hidden Hukum adds a face-down trump card and reveal-on-void behavior.
- With Auction Hukum off, the player after the dealer sees five cards and may choose hukum or pass; after three passes, the fourth caller must choose.
- With Auction Hukum on, every player sees their first five cards and gets one turn to bid or pass. Bids start at the normal trick majority and can rise to every available trick. If another player leads, the original hukum caller can keep hukum by matching that bid or give both the contract and hukum choice to the highest bidder. If everyone passes, or the original caller is already highest, the caller keeps automatically.
- The contract team must win at least its bid. Missing the contract awards the deal to the opposing team.
- The caller leads. Players must follow suit when possible; otherwise any card may be played.
- Highest card of the led suit wins unless a trump is played; highest trump wins.
- Every completed hand directly adds one to the winning team's hand count. The team with the majority wins the deal; with 36 cards this is 5 of 9 hands.
- Every won deal gives exactly 1 match point. First team to 4 points wins the match.
- The fourth card remains on the table for 1.6 seconds, then the trick animates into a visible captured pile beside its winner.
- Each turn has a server-authoritative 40-second timer. On timeout, the server plays a random legal card so the room never gets stuck.
- Players can exit to the home screen or request a full match restart. A restart resets only after all four players accept.
- Spectators can join an active room, choose one player to follow, and see that player's first five cards and full hand. Spectators are read-only and cannot play, choose hukum, change settings, or vote.
- The host can fill all currently empty seats with bots. A friend joining or changing teams before play can replace a bot seat when needed. Bots bid conservatively, choose hukum, and play legal cards automatically.
- Dealer and hukum caller rotate for the next round.

These rules live in `game.js`, while the UI displays the same direct Team A/Team B hand count used to decide the winner.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`. For same-Wi-Fi play, friends can open `http://YOUR_LOCAL_IP:3000` while the server is running.

## Configuration

Room creation and lobby controls let the host set the table theme, deck size, game mode, and Auction Hukum. Sound and celebration FX can be toggled independently during play. Deploy defaults can be changed with environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket listener port. Most hosts set this automatically. |
| `TURN_TIMEOUT_MS` | `40000` | Maximum time for a human turn before a legal card is played automatically. |
| `MATCH_TARGET` | `4` | Deals needed by a team to win a match. |
| `DEFAULT_DECK_SIZE` | `36` | New-room deck size: `20`–`52`, in steps of four. |
| `DEFAULT_MODE` | `single` | New-room mode: `single` (Normal Hukum) or `hidden` (Hidden Hukum). |
| `BOT_ACTION_DELAY_MS` | `650` | Pause before a bot chooses hukum or plays a card. |

Example:

```bash
MATCH_TARGET=6 DEFAULT_MODE=hidden npm start
```

## Share over the internet for free

Keep the game server running, then open a second terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:28080 --protocol http2 --no-autoupdate
```

`--protocol http2` forces TCP instead of QUIC. Use it if you see `Failed to dial a quic connection` / Cloudflare Error 1033 (common when the network blocks UDP 7844). Wait until the terminal prints `Registered tunnel connection` before opening the link — opening earlier also shows Error 1033.

Share the generated `https://...trycloudflare.com` link. This temporary link is free and needs no Cloudflare account, but it changes each time and stops when either terminal closes or the computer sleeps.

```text
Friends' phones/browsers
          │ HTTPS + WebSocket
          ▼
Temporary Cloudflare URL (free tunnel)
          │
          ▼
Your Mac: Node server → in-memory rooms/game state
```

## Deploy on Render Free

This repo includes a `render.yaml` Blueprint for one free Node web service:

1. Push the repo to GitHub.
2. In Render, choose **New > Blueprint** and connect the repo.
3. Apply the Blueprint, then share the generated HTTPS `onrender.com` URL.

The service uses `npm install`, `npm start`, and the `/health` endpoint. Render
supports the Socket.IO WebSocket connection used by the game.

Render Free's 512 MB RAM and 0.1 CPU are enough for a few small, friends-only
rooms. It should not lag under that light load, but it is not intended for many
busy rooms. A free service spins down after 15 minutes without traffic, so the
first visit afterward can take about a minute to wake it.

Rooms and active matches currently live only in server memory. A deploy,
restart, crash, or free-tier spin-down clears them, so players must create a new
room after the service wakes. Localhost avoids cold starts but requires your Mac
to stay awake and reachable; Render is the better option when friends should be
able to start playing without calling you.

## Test

Run rule and state-contract tests:

```bash
npm test
```

With `npm start` running in another terminal, the Socket.IO smoke checks are:

```bash
npm run smoke
npm run smoke:timeout
npm run smoke:auction
```

`smoke:auction` verifies theme creation, deliberate team movement, human bidding, and bot auction continuation.
