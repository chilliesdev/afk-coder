
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2024-05-23 - Focus Visible Outline on Inline HTML Buttons
**Learning:** Found an inline HTML template for OAuth callbacks that lacked keyboard navigation accessibility states. Users navigating via keyboard need visual cues (focus-visible).
**Action:** Always add explicit `:focus-visible` states with `outline` and `outline-offset` alongside standard hover states on basic HTML buttons, even in embedded templates.
