
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2026-07-02 - Added focus-visible for inline HTML accessibility
**Learning:** When writing simple inline HTML templates (e.g., for local OAuth callback servers), it's easy to overlook keyboard accessibility since standard UI component libraries aren't used. Focus indicators for interactive elements like buttons might only have `:hover` states defined, making them invisible to keyboard users.
**Action:** Always check for `:focus-visible` along with `:hover` when styling basic elements in raw HTML strings to ensure keyboard navigability without degrading mouse UX.
