
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2026-06-03 - Use focus-visible for better accessibility
**Learning:** In the login OAuth callback template, the close button lacked a focus indicator for keyboard users. Using `:focus-visible` is better than `:focus` because it only shows the focus ring when navigating via keyboard, avoiding visual noise for mouse users.
**Action:** Always prefer `:focus-visible` over `:focus` for interactive elements like buttons when adding focus rings.
