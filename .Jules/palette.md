
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2026-05-26 - Keyboard Focus Visibility on Embedded HTML Templates
**Learning:** Found that embedded HTML templates used for local OAuth authentication callbacks lacked explicit keyboard focus styles for buttons (`.btn`), relying on default browser styling which can sometimes be unclear.
**Action:** Added explicit `:focus-visible` CSS rules to the inline style blocks within `src/cli/index.ts` to ensure consistent and prominent focus indicators for keyboard navigation across different browsers.
