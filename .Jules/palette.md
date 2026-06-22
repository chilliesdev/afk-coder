
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2026-06-22 - Focus-Visible for Inline HTML Templates
**Learning:** For minimal, inline HTML UI templates (like local OAuth callbacks), explicitly using `:focus-visible` with an outline and offset provides essential keyboard navigation accessibility while significantly reducing visual noise for mouse users compared to a general `:focus` state.
**Action:** Always include `transition`, `outline: none` on the base class, and explicitly define `:focus-visible` with an `outline` and `outline-offset` for interactive elements in temporary/inline HTML UIs.
