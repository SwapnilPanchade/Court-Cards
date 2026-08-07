# Court Piece Online

A private-room, mobile-friendly Court Piece / Hokm game for friends or bots.

## Live

**Play:** [https://court-piece.fucksaurya.workers.dev](https://court-piece.fucksaurya.workers.dev)

Hosted on **Cloudflare Workers + Durable Objects** (Workers Free — no credit card).

| | |
| --- | --- |
| App URL | `https://court-piece.fucksaurya.workers.dev` |
| Account subdomain | `https://fucksaurya.workers.dev` |
| Health check | `https://court-piece.fucksaurya.workers.dev/health` |

Redeploy after changes:

```bash
export CLOUDFLARE_API_TOKEN=your_token   # or: npx wrangler login
npm run deploy
```

More detail: [DEPLOY.md](DEPLOY.md).

## Highlights

- Play with four friends, or fill empty seats with bots (joiners can pick which bot to replace).
- Cloudflare Worker serves the UI; each room is a Durable Object with WebSockets.
- Choose Team A or Team B before the deal; request a team switch anytime except mid-round.
- Host can transfer ownership; exit frees a seat in lobby (or becomes a bot mid-round).
- Host-configurable deck size, Normal or Hidden Hukum, and optional Auction Hukum (locked after start).
- Five table themes and ten room-scoped comic avatars.
- Scores keep accumulating for the life of the room; room closes when no humans remain.
- Responsive table for mobile landscape, with portrait fallback and desktop layout.

## Current rules

- Four players in two fixed seat pairs: seats 0 and 2 form Team A; seats 1 and 3 form Team B.
- Host-selectable decks from 20 to 52 cards in steps of four. A 36-card deck uses 6–A and deals 9 cards each.
- Normal Hukum and Hidden Hukum modes. Hidden Hukum adds a face-down trump card and reveal-on-void behavior.
- With Auction Hukum off, the player after the dealer sees five cards and may choose hukum or pass; after three passes, the fourth caller must choose.
- With Auction Hukum on, every player sees their first five cards and gets one turn to bid or pass. Bids start at the normal trick majority and can rise to every available trick. If another player leads, the original hukum caller can keep hukum by matching that bid or give both the contract and hukum choice to the highest bidder.
- The contract team must win at least its bid. Missing the contract awards the deal to the opposing team.
- The caller leads. Players must follow suit when possible; otherwise any card may be played.
- Highest card of the led suit wins unless a trump is played; highest trump wins.
- Every completed hand adds to the winning team's hand count. The team with the majority wins the deal.
- Every won deal gives the winning team 1 point on the room scoreboard. Scores do not auto-reset.
- Each turn has a 40-second timer. On timeout, a legal card is played automatically.
- Spectators can join, follow one player, and watch that hand (read-only).

Rules live in `src/game.js`.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open `http://127.0.0.1:8787` (`wrangler dev`).

## Deploy

```bash
npm run deploy
```

Uses [wrangler.toml](wrangler.toml). Static files come from `public/`; realtime rooms are Durable Objects.

## Test

```bash
npm test
```

With `npm start` running:

```bash
npm run smoke
```
