# AGENTS.md — Court Piece UI Redesign

Scope and constraints for any agent (human or Claude) working on this UI
redesign. Read `CLAUDE.md` first for the full context (current UI, issues,
proposed phases). This file is the quick operational reference.

## Ground rules

- **Frontend-only.** Touch `public/index.html`, `public/styles.css`,
  `public/app.js`. Do not modify `game.js` (rules engine) or `server.js`
  (Socket.IO transport) unless the task explicitly requires a new
  event/payload — and confirm with the user before doing so.
- **No framework migration.** Stay in plain HTML/CSS/vanilla JS. Do not
  introduce React, Vue, a bundler, or a CSS framework unless the user asks.
- **No build step.** Assets referenced from `index.html`/`styles.css` must work
  when served statically by `server.js` as-is today.
- **Two phases, don't blend them:**
  - Phase 1 = layout + visual redesign (landscape-first mobile table, refreshed
    palette/spacing). In scope now.
  - Phase 2 = event-driven animation/meme/audio effects (firecrackers, rockets,
    background audio on wins, etc.). Explicitly deferred — do not start
    building this until the user asks, even if it seems like a natural next
    step while touching CSS/animations in Phase 1.
- **Don't remove working game logic or Socket.IO event handling in `app.js`**
  while restyling — DOM element IDs (`#seat-0..3`, `#hand`, `#trick`, `#status`,
  panels like `#lobby-panel`/`#trump-panel`/`#round-panel`/`#restart-panel`,
  etc.) are read/written by `app.js`; if a redesign needs to rename or
  restructure them, update `app.js`'s selectors in the same change, don't leave
  it half-migrated.

## Before writing code

1. Confirm the target layout direction with the user (landscape-first mobile
   table vs. keep portrait as primary with landscape as an enhancement) if not
   already explicit.
2. Sketch/describe the new seat + hand + HUD arrangement before touching CSS,
   since the current absolute-positioning scheme (`.seat-top/left/right/bottom`,
   `.played-card[data-seat="N"]`) will likely need to change per orientation.

## Verification checklist for Phase 1 changes

- Load the app in the in-tool browser (`npm start`, then preview) and check:
  - Home screen (join/create table).
  - Game table in **landscape** mobile viewport (primary target) — all 4 seats,
    hand, trick area, HUD legible and not overlapping.
  - Game table in **portrait** mobile viewport (fallback) — same check.
  - Desktop width (`min-width: 700px` breakpoint already exists) still looks
    reasonable.
- Run `npm test` — Phase 1 should not change game logic, so existing tests must
  still pass.
- Do not claim "done" without having actually opened it in a browser and
  interacted with the golden path (create/join a table, see the hand render).

## Deferred / do not implement yet

- Sound effects, background music, situational memes/GIFs, firecracker/rocket
  visual effects, or any audio asset pipeline. These belong to Phase 2 and need
  their own scoping pass (asset sourcing/licensing, event-to-effect mapping,
  volume/mute controls) before any code is written.
