# Design QA

source visual truth: `/Users/swapnil/.codex/generated_images/019fe5f7-b674-73a3-89d9-75e414d11b9c/exec-9f4cdd5d-ac13-4171-a6bb-db67a60fab0a.png`

implementation screenshot: `/Users/swapnil/projects2/court-piece/artifacts/mobile-premium-rebuild-2026-08-09/rebuilt-active-final-844x390.png`

comparison image: `/Users/swapnil/projects2/court-piece/artifacts/mobile-premium-rebuild-2026-08-09/design-qa-side-by-side-final.png`

viewport: 844 x 390 CSS px, mobile landscape. Source pixels: 1844 x 853. Implementation capture: 1280 x 720, normalized to 844 x 390. Comparison: 1688 x 390.

state: Atelier table, active Court Piece round, Hukum chosen, four players visible, center trick and bottom hand rendered.

## Comparison evidence

- Full view: normalized side-by-side comparison confirms the same large mechanical table, compact top HUD, four-player arrangement, central play area, and foreground hand hierarchy.
- Focused table/HUD/hand review: avatars, cards, score, hands won, and Hukum remain legible at the target viewport without overlap.
- Fonts and palette: existing Fraunces/DM Sans system retained with the Atelier copper, cream, and dark mechanical palette.
- Assets and copy: Atelier table/avatar assets are sharp and game-specific labels replace generic reference copy.

## Findings and history

- First pass: table and profile scale were too small. Table increased from 112vw to 120vw; avatar range increased from 47-58px to 53-68px.
- Final pass: table is now the dominant surface while the header stays intentionally smaller than the reference, matching the user's explicit request.
- No P0, P1, or P2 visual issues remain. A softer hand backdrop is optional P3 polish after user feedback.

## Interaction and runtime checks

- Tested all six FX controls: card play, lightning cut, Ekka down, trick won, round won, and game won.
- Tested host removal confirmation and player removal.
- Tested selected profile avatar replacing the active seat avatar.
- Tested landscape and portrait layouts; final browser console has no errors.
- `npm test`: 41 tests passed. Auction rules are covered by tests; the auction HUD mapping was inspected but not manually played end-to-end in this pass.

final result: passed
