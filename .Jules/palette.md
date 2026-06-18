
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2026-06-18 - Focus Visible Styles for Inline Templates
**Learning:** When adding keyboard navigation to minimal inline HTML templates, explicitly using `:focus-visible` with an outline and offset (alongside standard hover states and transitions) provides clear focus feedback for keyboard users without causing visual noise for mouse users.
**Action:** Apply `:focus-visible` with consistent offsets and transitions to interactive elements in temporary/inline HTML views.
