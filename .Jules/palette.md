
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-22 - Add focus-visible to local HTML templates
**Learning:** Temporary local HTML callbacks (like OAuth login success screens) are still web interfaces and require basic accessibility states, even if they aren't part of a full frontend application.
**Action:** Always include basic keyboard accessibility styles like `:focus-visible` for buttons and links in temporary HTML templates.
