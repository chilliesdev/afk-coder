
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-06-07 - Add focus states to inline CLI HTML pages
**Learning:** Even transient/temporary inline HTML templates used by CLI local servers (like OAuth callback pages) need explicit keyboard focus states (`:focus-visible`). Keyboard users frequently interact with these pages when a CLI tool spawns a new browser window.
**Action:** Always verify that embedded HTML strings serving interactive UI (like buttons) include `focus-visible` states, and not just hover states.
