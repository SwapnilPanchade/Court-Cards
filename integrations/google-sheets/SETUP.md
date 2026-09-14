# Google Sheets money ledger — setup (one time, ~3 minutes)

The game keeps its ledger in Cloudflare (Durable Object SQLite). When this is set
up, it also pushes the full ledger to a Google Sheet you own after every recorded
game, payment confirmation, payment reset or day archive. A **Sync to Sheet**
button in the in-game Ledger pushes everything on demand (use it once to backfill).

## Tabs it writes

| Tab | Contents |
| --- | --- |
| Summary | Per player: games, won, lost, win %, net from games, paid out, received, balance, today's net — all live formulas — plus the app's own balance as a cross-check |
| Settle now | Who pays whom right now, with confirmation status |
| Games | One row per game: day, time (IST), room, stake, teams, winners, hukum + caller, mode, auction, contract, hands, court, room score, bids/passes |
| Player results | One row per player per game: result and ₹ won/lost |
| Payments | Every payment: amount, confirmations, status (Completed / Reset / Waiting / Outdated), times |
| Days | Each ledger day and whether it is archived |

These tabs are rewritten on every sync — put your own notes or charts in other tabs.

## Steps

1. Create a new Google Sheet (e.g. "Court Piece Ledger").
2. **Extensions → Apps Script**. Delete the sample code and paste all of
   [`Code.gs`](Code.gs).
3. Replace `PASTE-THE-SECRET-HERE` with a long random secret (any 30+ characters)
   and save.
4. **Deploy → New deployment → ⚙ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy, approve the Google permission prompt, and copy the **Web app URL**
     (ends in `/exec`).
5. Give the game the URL and the same secret:

   ```bash
   npx wrangler secret put SHEET_SYNC_URL
   npx wrangler secret put SHEET_SYNC_SECRET
   ```

6. Open the Ledger in the game and press **Sync to Sheet** once to backfill every
   past game.

If you edit `Code.gs` later, use **Deploy → Manage deployments → Edit → New
version** so the same URL keeps working.

Local testing: put `SHEET_SYNC_URL` and `SHEET_SYNC_SECRET` in `.dev.vars`.
