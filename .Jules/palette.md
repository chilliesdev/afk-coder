
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-24 - Focus Visible Accessibility
**Learning:** In simple, inline HTML templates without a design system, buttons often lack clear keyboard focus states. Users navigating via keyboard need visual confirmation of focus.
**Action:** Always add `:focus-visible` states to interactive elements (like buttons) in custom HTML templates to ensure accessibility for keyboard users.
