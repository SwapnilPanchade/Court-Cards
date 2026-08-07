# Deploy (Cloudflare Workers — free)

This app runs on **Cloudflare Workers + Durable Objects** (Workers Free plan). No credit card required for the free tier.

## One-time setup

1. Create a free Cloudflare account: https://dash.cloudflare.com/sign-up
2. In this repo:

```bash
npm install
npx wrangler login
```

## Local

```bash
npm start
```

Opens `wrangler dev` (usually http://127.0.0.1:8787).

## Production

```bash
npm run deploy
```

You get a public URL like:

`https://court-piece.fucksaurya.workers.dev`

Share that with friends — rooms are Durable Objects (one per room code).

## Health

`GET /health` → `{ "ok": true }`

Rooms auto-close when the last **human** leaves (bots alone do not keep a room alive). Scores persist for the life of the room.
