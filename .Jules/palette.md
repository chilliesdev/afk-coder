
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-29 - Keyboard Accessibility Focus States
**Learning:** Found that the temporary HTML pages used for local OAuth authentication callbacks lacked keyboard focus indicators. Using `:focus-visible` is better than `:focus` because it only shows the focus ring when navigating via keyboard (not on mouse click), reducing visual noise for mouse users while maintaining accessibility.
**Action:** Add `:focus-visible` CSS rules with a clear `outline` and `outline-offset` to all interactive elements (.btn) to ensure focus visibility for keyboard navigation.
