
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-06-21 - Accessible focus states on inline HTML buttons
**Learning:** Minimal inline HTML templates (like OAuth callbacks) often lack focus states. Explicitly using `:focus-visible` with an outline and offset improves keyboard accessibility and reduces visual noise for mouse users.
**Action:** Always include `:focus-visible` with outline and offset alongside standard hover and transition states in inline templates.
