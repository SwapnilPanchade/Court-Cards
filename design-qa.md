# Hukum Atelier — Design QA

## Comparison target

- Source visual truth: `/Users/swapnil/.codex/generated_images/019fe5f7-b674-73a3-89d9-75e414d11b9c/exec-9f4cdd5d-ac13-4171-a6bb-db67a60fab0a.png`
- Rendered implementation: `/Users/swapnil/projects2/court-piece/artifacts/atelier-build-2026-08-09/26-atelier-active-844x390.png`
- Local route/state: `http://localhost:8787/?room=E7WBJ`, Atelier selected, four-player bot table, Hukum chosen, local player's turn.
- CSS viewport: `844 x 390`; device pixel ratio: `1`.
- Source pixels: `1844 x 853`; implementation pixels: `844 x 390`.
- Density normalization: source scaled proportionally to `844 x 390` with centered padding; implementation captured 1:1 at the same CSS viewport. Combined evidence is `artifacts/atelier-build-2026-08-09/27-source-vs-build.png` (`1688 x 390`).

## Findings

- No actionable P0, P1, or P2 findings remain.
- Fonts and typography: Fraunces-led display type and compact sans-serif HUD preserve the source's editorial/luxury hierarchy. Labels remain readable at the primary landscape viewport; portrait intentionally removes team/bot micro-labels to prevent collisions.
- Spacing and layout rhythm: full-bleed table, centered scoreboard, four seat anchors, central mechanism, and bottom hand dock match the source composition. Landscape, portrait, and desktop checks show no hidden persistent controls or overlapping player faces.
- Colors and visual tokens: ivory, oxidized emerald, aged brass, black lacquer, and blue/red team accents map to the source. Shadows and borders read as physical table hardware instead of generic cards.
- Image quality and asset fidelity: the generated 1840 x 855 Atelier plate is sharp at all tested sizes and carries the required physical-table art. Existing avatar assets intentionally remain the product's selected profile catalog; each now fills and replaces the face medallion rather than appearing beside initials.
- Copy and content: dynamic game copy remains accurate. `Your turn`, Hukum, hand score, player names, and the Ace-cut `EKKA OVERRULED` reveal fit the existing game vocabulary.
- Accessibility and behavior: semantic buttons/radios remain intact, the selected profile has an aria-label, effect controls still work, and reduced-motion rules suppress the special Ace scene.

## Full-view comparison evidence

- Final side-by-side: `artifacts/atelier-build-2026-08-09/27-source-vs-build.png`.
- Result: the implementation preserves the same premium oval-table silhouette, palette, four-seat spatial system, central mechanical focal point, compact top HUD, and physical bottom card rail. Dynamic room state and the existing illustrated avatar catalog are intentional product differences.

## Focused region comparison evidence

- Profile medallion comparison: `artifacts/atelier-build-2026-08-09/28-profile-medallion-comparison.png`.
- Result: the selected profile fully fills the brass medallion and no initials or side-by-side duplicate remain. The implementation uses the existing illustrated profile catalog by design.
- Ace tear choreography: `artifacts/atelier-build-2026-08-09/12-ace-tear-final.png` and `artifacts/atelier-build-2026-08-09/14-ace-cut-reveal-final.png`.
- Responsive evidence: `artifacts/atelier-build-2026-08-09/20-atelier-portrait-aligned.png` and `artifacts/atelier-build-2026-08-09/22-atelier-desktop-refined.png`.

## Comparison history

1. **[P2] Generic card-play burst obscured the premium table.**
   - Earlier evidence: `artifacts/atelier-build-2026-08-09/05-card-motion-atelier.png`.
   - Fix: Atelier card play now uses only the real seat-to-table 3D card motion; the duplicate full-screen `PLAY` burst is skipped.
   - Post-fix evidence: `artifacts/atelier-build-2026-08-09/06-card-motion-refined.png`.
2. **[P1] Ace-cut scene failed on a multi-class DOM token.**
   - Earlier evidence: browser error from `cloneAtelierCard` while running the live effect harness.
   - Fix: class names are split into valid DOM tokens; original Ace and Hukum cards are temporarily hidden, torn clones animate, Hukum rises, and the originals restore after cleanup.
   - Post-fix evidence: `artifacts/atelier-build-2026-08-09/12-ace-tear-final.png` and `artifacts/atelier-build-2026-08-09/14-ace-cut-reveal-final.png`; final browser console has no errors or warnings.
3. **[P2] Landscape Hukum panel covered the selected player medallion.**
   - Earlier evidence: `artifacts/atelier-build-2026-08-09/15-hukum-panel-refined.png`.
   - Fix: narrowed the side console, forced stable seat transforms, and increased/profile-cropped the medallions.
   - Post-fix evidence: `artifacts/atelier-build-2026-08-09/17-profile-medallion-final.png` plus computed profile image `biker-didi.webp` filling the medallion.
4. **[P2] Portrait Hukum state hid and misaligned the bottom player.**
   - Earlier evidence: `artifacts/atelier-build-2026-08-09/18-atelier-portrait-390x844.png`.
   - Fix: moved the bottom seat above the choice sheet, centered all seats with transform overrides, and compacted portrait nameplates.
   - Post-fix evidence: `artifacts/atelier-build-2026-08-09/20-atelier-portrait-aligned.png`.
5. **[P2] Desktop choice panel covered the right player.**
   - Earlier evidence: `artifacts/atelier-build-2026-08-09/21-atelier-desktop-1440x900.png`.
   - Fix: moved the desktop side console above the right seat.
   - Post-fix evidence: `artifacts/atelier-build-2026-08-09/22-atelier-desktop-refined.png`; all four avatar centers were browser-verified as visible.

## Primary interactions tested

- Create a private Atelier room.
- Confirm selected Biker Didi profile replaces the local medallion.
- Fill empty seats with bots and start the game.
- Choose Hukum and enter active play.
- Play a legal card and inspect the motion frame.
- Run the event-driven Ace-cut choreography with real card DOM faces.
- Check landscape `844 x 390`, portrait `390 x 844`, and desktop `1440 x 900`.
- Check browser console errors/warnings: none in the final run.

## Open questions

- None blocking. A future avatar-library refresh could move the existing illustrated portraits closer to the mock's semi-realistic rendering, but that is a separate asset-direction decision rather than an implementation defect.

## Implementation checklist

- [x] New opt-in Atelier table without changing existing defaults.
- [x] Server-synced theme allowlist and tests.
- [x] Full selected-profile medallion replacement.
- [x] Deal, play, capture, Hukum-cut, and Ace-tear motion.
- [x] Reduced-motion fallback.
- [x] Landscape, portrait, and desktop browser checks.
- [x] Source-versus-build and focused-region comparisons.

## Follow-up polish

- P3: if the avatar library is redesigned later, generate a consistent semi-realistic portrait set that matches the mock while retaining the same replacement behavior and asset IDs.

final result: passed
