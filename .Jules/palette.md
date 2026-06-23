
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-11-20 - Focus States in Minimal HTML Templates
**Learning:** Found that minimal inline HTML templates used for temporary local web servers (like OAuth callbacks) lacked keyboard focus states, making buttons inaccessible for keyboard users who tab through the page.
**Action:** Always ensure `:focus-visible` with a clear `outline` and `outline-offset` is added alongside `:hover` states, even in minimal embedded HTML templates, to ensure basic keyboard accessibility. Added to `src/cli/commands/login.ts`.
