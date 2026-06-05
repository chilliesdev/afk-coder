
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2026-06-05 - [Inline HTML Focus Accessibility]
**Learning:** Temporary, inline HTML templates (such as local OAuth authentication callbacks) can easily overlook essential interactive states like focus indicators for buttons, which impacts keyboard navigation accessibility even for short-lived UI.
**Action:** When creating or modifying inline HTML responses, explicitly include `:focus-visible` CSS rules for interactive elements like `.btn` to ensure consistent accessibility across all touchpoints.
