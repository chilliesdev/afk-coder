
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-23 - Focus Visible on Authentication Callbacks
**Learning:** Temporary inline HTML pages (like OAuth callbacks) often lack proper accessibility styling since they are generated programmatically and lack external CSS. Buttons must have proper focus states for keyboard navigation.
**Action:** Used `:focus-visible` to add an outline and offset for focus states without adding visual noise for mouse users.
