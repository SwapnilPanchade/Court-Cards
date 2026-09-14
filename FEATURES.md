# Court Piece — Feature Checklist

What the game does today, with how each feature is verified. Focus is the
**4-player Court Piece** table; 6-player, Judgment and Rummy are listed after.

Legend: **U** = unit test (`npm test`) · **S** = WebSocket smoke test against
`wrangler dev` (`npm run smoke`, `npm run smoke:settlement`) · **B** = checked by
hand in the browser at phone sizes (844×390 landscape, 390×844 portrait) ·
**⚠** = known gap.

Last full check: 2026-09-14 — `npm test` 56/56 pass, both smoke tests pass.

## 1. Joining a table

| Feature | How it works | Verified |
| --- | --- | --- |
| Create a private table | Pick game, table size, name, avatar, theme, auction, money, stake → 5-letter room code | S, B |
| Join by code / invite link | Enter code or open `?room=CODE`; live availability check | S, B |
| Fixed roster names | Only Pradeep, Swapnil, Ajit, Ajay, Saurabh, John, James, Rahul, Nishant; no duplicates at a table | U |
| Resume after refresh | Stored token re-seats you in the same seat | B |
| Spectator mode | Watch a table, pick which player's hand to follow (read-only) | U (view flags) |
| Replace a bot | If no seat is empty, joiner picks which bot seat to take | U, S |

## 2. Lobby (before the first deal)

| Feature | How it works | Verified |
| --- | --- | --- |
| Choose Team A / B | Prefers an empty seat, can replace a bot, rejects a full human team. Partners sit opposite | U, B |
| **Team switch request** | Tap *Request switch* on an opposing player's seat, or *Swap with …* in the setup sheet. They get an Accept/Decline popup; accepting swaps seats (and host seat). The requester can *Cancel request* | U, S, B |
| Fill with bots | Host fills every empty seat with bots | S |
| Host settings | Deck size (20–52), Normal / Hidden Hukum, Auction Hukum, Track money + stake. Locked once play starts | U |
| Table theme | Noir, Comic, 2088, Adda, Gully, Atelier | U, B |
| Room avatar | 10 avatars, locked after play starts | U |
| Transfer host | Host hands control to another human | U, S |
| Remove player | Host removes a seat (lobby → seat freed; mid-round → bot takes over), with confirm dialog | U |
| Share invite | Copies the invite link | B |

## 3. Playing a 4-player deal

| Feature | How it works | Verified |
| --- | --- | --- |
| Deal | 36-card deck (6–A) deals 9 each by default | U |
| Normal Hukum | Player after dealer sees 5 cards, chooses hukum or passes; 4th caller must choose | U |
| Hidden Hukum | Caller picks a face-down card; revealed when a player can't follow suit (*Reveal hukum*) | U |
| Auction Hukum | Everyone sees 5 cards and bids once; original caller keeps (matching) or gives contract + hukum to top bidder; all-pass forces the opener | U |
| Contract result | Contract team must win at least its bid, else the deal goes to the other team | U |
| Follow suit / trump | Must follow led suit; highest trump wins, else highest of led suit | U |
| Full deal played | All tricks are played even after a majority | U |
| Tie rule | Even split of tricks = caller's team fails the majority | U |
| Turn timer | 40 s per turn; a legal card is auto-played on timeout | ⚠ legacy `timeout-smoke.js` targets the old Socket.IO server and no longer runs |
| **Forced card auto-play** | If a player has exactly one legal card (one card of the led suit, or their last card), it plays itself after ~1.2 s and the status bar says so. Skipped in hidden hukum while the player could still reveal | U |
| Hukum badge (top bar) | `Hukum ♠ · Name` · with auction: `· needs N hands` · hidden: `Hukum hidden · Name` (caller sees `(only you)`) | B |
| Match details drawer | Tap the scoreboard: scores, hands, contract, full bid/pass history | B |
| Restart vote | Any player asks for a fresh deal; everyone must accept (score kept) | — (not re-tested) |

## 4. Between deals

| Feature | How it works | Verified |
| --- | --- | --- |
| Scoring | Winning team gets 1 point per deal; scores never auto-reset | U |
| Round result sheet | Winner, hands, score, contract made/failed; host deals next | B |
| Team switch between deals | Same request/accept flow; switch buttons also shown in the result sheet | U, B |
| Court (clean sweep) | Extra effect + burn text when a team takes zero tricks | — |

## 5. Money ledger (Court Piece only)

| Feature | How it works | Verified |
| --- | --- | --- |
| Per-deal entry | Completed deal with 4 distinct roster humans: each loser pays stake, each winner receives stake | U, S |
| Configurable stake | ₹1–₹10,000 per player, snapshotted per deal | U |
| Money off | Host can turn tracking off for the room | U |
| Bots / other games excluded | Deals that start with any bot, deals where a bot takes over a seat mid-deal, and Judgment/Rummy never count | U |
| Team changes | Teams snapshotted per deal; balances netted per person | U |
| Settle up | Minimum transfers; payer confirms *Paid*, receiver confirms *Received*; either can reset | U, S |
| Archive day | Only when every balance is ₹0 | S |
| Round story per game | Each recorded game also stores hukum + caller, hidden/normal, auction bids/passes, contract made/failed, hands per team, court, room score — shown under the game in *Game history* | U |
| Storage | Cloudflare Durable Object SQLite (`settlement_games`, `settlement_payments`, `settlement_sessions`); `details` column added by migration 3 | S |
| Google Sheets mirror | After every recorded game, payment confirm/reset or day archive the full ledger is pushed to a Google Sheet (Summary with formulas, Settle now, Games, Player results, Payments, Days). *Sync to Sheet* in the Ledger backfills on demand. Setup: [integrations/google-sheets/SETUP.md](integrations/google-sheets/SETUP.md) | U, S (mock endpoint) |

## 6. Table & effects

| Feature | Verified |
| --- | --- |
| Landscape phone layout (primary), portrait fallback, desktop | B |
| Sound + FX toggles, FX demo lab (card play, lightning cut, ekka down, trick/round/game won) | B (earlier design QA) |
| Trick capture animation, deal animation, trump-cut slice | — |

## 7. Other modes

| Feature | Verified |
| --- | --- |
| 6-player Court Piece (2 teams of 3, 48 cards, 8 each, 6th caller must choose) | U |
| Judgment (13 cards, calls, scoring) | U |
| Rummy (13 cards, draw then discard, 2 sequences incl. 1 pure) | U |

## Known gaps / follow-ups

- `test/auction-smoke.js`, `test/timeout-smoke.js`, `test/smoke.js` and
  `test/room-bots.js` still target the retired Socket.IO server on port 3000.
