
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-06-06 - Embedded HTML Template Accessibility
**Learning:** Temporary/embedded HTML templates for CLI tools (like OAuth callbacks) often forget accessibility basics because they aren't part of the main web frontend. Keyboard navigation on these pages is essential since the user is coming directly from a terminal.
**Action:** Explicitly add `:focus-visible` styles and transitions to inline CSS for embedded HTML templates.
