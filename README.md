# Court Piece Online

A private-room, mobile-friendly Court Piece / Hokm game for four friends.

## Current rules

- Four players in fixed teams: seats 1 and 3 vs seats 2 and 4.
- Host-selectable decks from 20 to 52 cards in steps of four. A 36-card deck uses 6–A and deals 9 cards each.
- Single Sir, Double Sir, and Hidden Sir modes. Double Sir uses the standard consecutive-winner pool; Hidden Sir adds a face-down trump card and reveal-on-void behavior.
- The hukum caller may pass bad first-five cards to the next player; after three passes, the fourth caller must choose.
- The player after the dealer sees five cards and chooses the hukum (trump).
- The caller leads. Players must follow suit when possible; otherwise any card may be played.
- Highest card of the led suit wins unless a trump is played; highest trump wins.
- In Single Sir, the first team to a majority of tricks wins. With 36 cards this is 5 of 9 tricks. In Double/Hidden Sir, the last trick resolves any remaining pool and the majority wins.
- Every won deal gives exactly 1 match point. First team to 4 points wins the match.
- The fourth card remains on the table for 1.6 seconds, then the trick animates into a visible captured pile beside its winner.
- Each turn has a server-authoritative 40-second timer. On timeout, the server plays a random legal card so the room never gets stuck.
- Players can exit to the home screen or request a full match restart. A restart resets only after all four players accept.
- Spectators can join an active room, choose one player to follow, and see that player's first five cards and full hand. Spectators are read-only and cannot play, choose hukum, change settings, or vote.
- Dealer and hukum caller rotate for the next round.

These rules live in `game.js`, so variants such as Double Sir or different Court scoring can be added without rewriting the UI.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`. For same-Wi-Fi play, friends can open `http://YOUR_LOCAL_IP:3000` while the server is running.

## Share over the internet for free

Keep the game server running, then open a second terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate
```

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

## Put it online

Deploy this folder to any Node host (Render, Railway, Fly.io, or similar) with:

- Build command: `npm install`
- Start command: `npm start`
- Health endpoint: `/health`

The host must support WebSockets. Rooms currently live in server memory, which is suitable for one server instance and private friend games. A later production version should add Redis for multiple instances and persistent accounts/match history only if those features are needed.

## Test

```bash
npm test
```
