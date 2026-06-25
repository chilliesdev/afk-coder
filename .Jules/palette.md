
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-03-24 - Minimal Template Accessibility
**Learning:** Even in minimal, inline HTML templates (like temporary OAuth callbacks), keyboard accessibility is easily overlooked. Using `:focus-visible` with an outline and offset is highly effective because it provides clear focus indicators for keyboard navigation while remaining invisible to mouse users, reducing visual noise.
**Action:** Always include `:focus-visible` alongside standard `:hover` and `:focus` states in any custom HTML templates or minimal UI elements, no matter how brief their visibility.
