
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2024-05-08 - Use :focus-visible for Temporary HTML Templates
**Learning:** When writing simple inline HTML pages (like OAuth callbacks), it's easy to overlook keyboard accessibility styling. Using `:focus-visible` is an ideal, lightweight way to provide clear focus indicators for keyboard users while avoiding unwanted visual noise (outlines) for mouse users.
**Action:** Always include a `:focus-visible` rule for interactive elements (`a`, `button`) when defining inline CSS styles in temporary pages.
