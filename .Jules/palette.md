
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-24 - Focus States in Temporary UIs
**Learning:** Found that dynamically generated HTML for local OAuth callback servers lacked proper keyboard focus states, making the "Close Window" button difficult to use for keyboard-only users.
**Action:** Added `:focus-visible` styling and a smooth transition to interactive elements in temporary server responses to ensure full accessibility even in non-persistent UI.
