
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2024-06-11 - Adding Keyboard Accessibility to Inline HTML Templates
**Learning:** Found that inline HTML templates (like those used for simple callback pages) often lack basic keyboard accessibility features like focus states for buttons. Using `:focus-visible` provides a clear indicator for keyboard navigation without adding visual noise for mouse users.
**Action:** Added `:focus-visible` outline styles to the `.btn` class in the OAuth callback inline HTML template.
