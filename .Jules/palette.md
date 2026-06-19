
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2024-05-22 - Keyboard accessibility focus outlines for embedded HTML
**Learning:** Even simple embedded HTML templates (like the OAuth callback page) benefit from standard accessibility improvements. `focus-visible` styling is essential to ensure keyboard users can navigate effectively without overwhelming visual noise for mouse users.
**Action:** When creating or modifying inline HTML UI, always include `:focus-visible` outline styles for interactive elements (like buttons).
