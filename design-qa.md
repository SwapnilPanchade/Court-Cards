# Design QA — Court Piece redesign

- Source reference: `/var/folders/td/9_5qb8nd531_6fhnbtjv0pt00000gn/T/codex-clipboard-735e67ee-5e64-4e76-b251-508eaaad36a0.png`
- Implementation evidence: `/private/tmp/court-piece-avatar-only-final.png`, `/private/tmp/court-piece-game-844x390.png`, `/private/tmp/court-piece-game-390x844.png`
- Combined comparison: `/private/tmp/court-piece-design-qa-comparison.png`
- Desktop viewport: requested 1440×900; browser runtime CSS viewport 1200×750 at 1.2 density
- Landscape viewport: requested 844×390; browser runtime CSS viewport 703×325
- Portrait viewport: requested 390×844; browser runtime CSS viewport 325×703
- State: four-player Comic table with three bots, real generated avatars, completed deal/result overlay

## Evidence and interactions

- Created a private Comic table, enabled Auction Hukum, filled three empty seats with bots, and started a live deal.
- Confirmed all four selected avatar assets rendered at the seats.
- Confirmed the 13-card hand uses overlap/fan layout without horizontal scrolling.
- Landscape: document 703×325, no horizontal overflow, hand bottom 320 within viewport.
- Portrait: document 325×703, no horizontal overflow, hand bottom 695 within viewport.
- Desktop: document 1200×750 with no page overflow.
- Console errors: none.

## Comparison history

1. Initial implementation used large yellow/pink rectangular seat cards that competed with the illustrated table characters.
2. Replaced them with avatar-only circular portraits, compact name/team pills, and small round card/trick counters.
3. Compared the reference and corrected implementation side by side; comic ink, paper grain, palette, character treatment, and table proportions remain consistent.

## Findings

- No P0, P1, or P2 visual defects found.
- Selected avatars are now the primary player identity; the environment characters read as background art.
- HUD, table, result overlay, and hand remain legible across desktop, mobile landscape, and mobile portrait.

final result: passed
