# Court Piece — UI Redesign

Working notes for the UI/UX overhaul of this Court Piece (Hokm-style) multiplayer
card game. This file documents the **current state**, the **problems** the user
called out, and the **proposed direction**. No implementation has started yet —
this is the shared understanding to align on before writing code.

## Current stack (unchanged by this redesign)

- Static frontend: `public/index.html`, `public/styles.css`, `public/app.js` (plain
  JS + DOM, no framework, no build step).
- `server.js` (Express + Socket.IO) and `game.js` (game rules) are untouched by a
  UI redesign — this work is presentation-layer only unless we decide otherwise.
- No animation library, no sound assets, no asset pipeline currently exist.

## Current UI, as it stands today

- Single portrait-oriented layout (`.shell`, `max-width: 440px`) for both the home
  screen and the in-game screen. There is **one** layout — no responsive
  alternative for landscape or larger screens beyond a single `@media
  (min-width: 700px)` tweak that just resizes the table and hand height.
- Home screen: dark green radial gradient background, gold accents, a rotated
  "brand-mark" square, DM Sans + Fraunces fonts, a single glassy join card.
- Game screen: an oval/elliptical "table" div in the center with 4 absolutely
  positioned seats (top/left/right/bottom), a trick zone in the middle, and a
  horizontally overlapping card hand pinned to the bottom.
- Colors: deep green (`#061913`/`#0e3b2e`) + gold (`#e9bb62`) felt-table palette,
  applied fairly uniformly (buttons, borders, badges all reuse the same 2 hues).
- Animations that exist today are minimal and functional, not thematic:
  `scorePop`, `capturePop`, `trickPulse`, `winnerIn`, `timerPulse` — small CSS
  keyframe transforms/opacity changes, no audio, no particle/confetti effects.

## Problems identified (per user)

1. **Visual design feels dated/inconsistent** — gradients, color choices, and
   card/seat placement don't feel like a polished modern card-game table.
2. **Only one layout mode.** No distinct treatment for how the table, hand, and
   opponents are arranged — everything is squeezed into a portrait phone shell,
   even though card games (Teen Patti, Junglee Rummy, and similar apps) commonly
   use a **horizontal/landscape table layout on mobile**, which reads much better
   for a 4-seat card table (opponents arranged left/right/top, big central felt,
   fanned hand along the bottom edge in landscape).
3. **No personality/juice.** No situational animations, memes, or audio cues
   (e.g. crowd/firecracker/rocket effects for winning a hand or the match,
   funny stings for specific events). Explicitly called out as a **later phase**,
   not part of the first redesign pass.

## Proposed direction

### Phase 1 — Visual + layout redesign (this phase)

- Reference points: Teen Patti / Junglee Rummy-style mobile table UIs — a
  landscape-oriented felt table as the primary mobile experience, not portrait.
- Redesign the table view for **landscape/horizontal** as the primary mobile
  layout:
  - Opponent seats arranged around an oval table that fills the horizontal
    viewport, avatars + name + card-count chips per seat.
  - Player's own hand fanned along the bottom edge, larger touch targets since
    horizontal space is more generous.
  - Score/trump/timer HUD condensed into corners/top bar instead of stacked
    center elements, so the felt table stays the visual focus.
  - Keep portrait usable as a fallback (e.g. a "rotate your device" prompt or a
    simpler stacked layout) rather than removing it outright — final call TBD
    with the user.
- Refresh the visual language: revisit the palette/gradients (still a felt-table
  green + gold theme, per game branding, but less flat/uniform — richer felt
  texture, more considered contrast between background, table, and UI chrome),
  refine card art/spacing, and improve seat/avatar/trick placement so it reads
  clearly at a glance.
- Deliverable for this phase: updated `public/index.html` structure (if needed)
  + a substantially reworked `public/styles.css`, verified in the browser at
  common mobile landscape + portrait sizes, no game-logic changes.

### Phase 2 — Situational animation & audio (explicitly deferred, not now)

- Event-driven "juice": e.g. firecracker/rocket/confetti visual effects and
  background audio stings tied to specific game events (winning a trick,
  winning a hand, winning the match, calling trump, etc.), plus room for
  meme-style flourishes.
- Will need: an audio/asset pipeline (where sound/gif/video assets live, how
  they're loaded and licensed), a lightweight animation/effects layer, and a
  mapping from game events (already emitted via Socket.IO) to effect triggers.
- Not scoped or estimated yet — will be planned in detail once Phase 1 lands
  and the user has used the new layout.

## How we'll work

1. Land Phase 1 (layout + visual) fully, get it in front of the user in a
   browser on both portrait and landscape mobile viewports before calling it
   done.
2. Only after Phase 1 is confirmed, scope Phase 2 (animations/audio) as its own
   piece of work with a concrete asset/event plan.
3. No game-rule or server changes as part of either phase unless explicitly
   requested.
