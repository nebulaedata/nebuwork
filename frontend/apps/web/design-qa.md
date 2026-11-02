# NebuWork Wide Layout Design QA

## Comparison target

- User-reported source: `C:/Users/JYZ-SU~1/AppData/Local/Temp/codex-clipboard-0fbe3987-2534-40c1-8d66-7eb7a6e098a7.png`.
- Rendered implementation: `http://127.0.0.1:4176/#/agents` from `apps/web`.
- Evidence: `D:/Work/Code/AiCode/NebuWorkAgent/.qa/max-width/`.
- Wide viewport: 2560 × 1319 CSS px. Desktop viewport: 1280 × 720 CSS px.
- State: authenticated, light theme, unchanged mock seed.

## Full-view comparison evidence

- Before (`before-wide.jpg`): `.page` was capped at 1280 px and the card grid at 1216 px, leaving 1216 px unused to the right of the page at the wide viewport.
- After (`after-wide.jpg`): `.page` expands to 2496 px and the card grid to 2432 px; the page reaches the viewport edge while retaining the original 32 px inner padding.
- Desktop (`after-desktop.jpg`): `.page` is 1208 px inside the 1280 px viewport and the document remains exactly 1280 px wide, with no horizontal overflow.

## Focused layout checks

- The catalog grows from three to six columns at 2560 px, keeping each card at a readable 392 px instead of stretching cards to nearly 800 px; 16 px gutters remain even.
- `#/agent/a9?tab=rules` uses the same fluid page shell at 1280 px without overflow.
- Settings forms with explicit inline maximum widths remain intentionally narrow because the correction is layered after, rather than written into, the synced prototype stylesheet.
- Typography, colors, mock content, controls, icons and route behavior are unchanged.

## Implementation decision

- The update reference remains byte-for-byte immutable for parity testing.
- `layout-overrides.css` carries the intentional product correction and is imported after `styles.css`.
- The durable fluid-layout rule is recorded in `apps/web/AGENTS.md`.

## Verification

- Root `npm run check` passed: Agent Core build/tests, API build/tests, web typecheck, 13 source-parity tests, production build and 4 Sites worker tests.
- No P0, P1 or P2 visual, responsive, content or interaction findings remain for this correction.

## Open questions

- None.

final result: passed
