
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2024-05-22 - Missing focus-visible styles on buttons
**Learning:** Found a case where a button only relied on standard `:hover` and `:focus` states. For accessibility, `:focus-visible` with a distinct outline offset provides a much clearer focus indicator for keyboard users while reducing visual noise for mouse users.
**Action:** Added `:focus-visible` with `outline` and `outline-offset` alongside a `transition` to the `.btn` class to improve keyboard navigation accessibility without breaking the core style.
