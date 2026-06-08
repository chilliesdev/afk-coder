
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-06-08 - Keyboard accessibility improvements with :focus-visible
**Learning:** For keyboard accessibility improvements on UI elements, using `:focus-visible` over `:focus` is preferred because it significantly reduces visual noise for mouse users while still providing clear focus indicators for those navigating via keyboard.
**Action:** When adding focus states to interactive elements, use `.element:focus-visible` to style an outline or similar prominent indicator instead of a generic `:focus` state.
