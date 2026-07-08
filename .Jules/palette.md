
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-10-26 - Improve keyboard accessibility on inline HTML templates
**Learning:** Found that inline HTML templates for local OAuth authentication callbacks were lacking keyboard focus indicators.
**Action:** Added explicitly styled `:focus-visible` states with an outline and offset to buttons to ensure keyboard accessibility without increasing visual noise for mouse users.
