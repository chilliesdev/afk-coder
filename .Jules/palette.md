
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-24 - Focus-Visible in Inline Templates
**Learning:** Even simple, temporary inline HTML templates (like those used for CLI OAuth callbacks) benefit from explicit keyboard accessibility (`:focus-visible`) and transitions, which are often overlooked compared to full web apps.
**Action:** Always include basic `.btn:focus-visible` outline styles and transitions when writing minimal HTML string templates for local servers.
