
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-24 - Minimal Inline HTML Keyboard Accessibility
**Learning:** When making UX improvements to minimal, inline HTML templates (like those used for simple OAuth callback pages), explicitly using `:focus-visible` with an outline and offset (alongside standard hover states) provides clear keyboard navigation without adding visual noise for mouse users, compared to a general `:focus` state.
**Action:** Apply `:focus-visible` explicitly for focus states in minimal HTML structures to maintain accessibility while reducing visual noise for pointer device users.
