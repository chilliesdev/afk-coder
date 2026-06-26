
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2026-06-26 - Focus-Visible for Inline HTML
**Learning:** Found that minimal inline HTML templates (like OAuth callbacks) lacked proper keyboard navigation focus states.
**Action:** Added `:focus-visible` with an outline and offset to the primary button class alongside standard transitions.
