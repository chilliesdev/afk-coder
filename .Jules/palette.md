
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2026-06-10 - Accessibility in temporary HTML templates
**Learning:** Temporary embedded HTML templates in CLI tools require standard accessibility treatments like focus states.
**Action:** Added :focus-visible rules to inline HTML template buttons.
