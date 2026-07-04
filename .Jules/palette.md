
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-23 - Focus styles for minimal inline HTML templates
**Learning:** Found an inline HTML template where `.btn` only had `hover` states, lacking keyboard navigation support, making it unnoticeable for users relying on keyboard tabbing.
**Action:** Always add `:focus-visible` with `outline` and `outline-offset` instead of basic `:focus` to ensure visibility for keyboard navigation while reducing visual noise for mouse users in minimal inline template buttons.
