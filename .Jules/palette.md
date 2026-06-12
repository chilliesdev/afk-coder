
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2026-06-12 - Added focus-visible states to embedded HTML
**Learning:** Even simple embedded HTML templates in CLI tools (like local OAuth callbacks) need explicit focus indicators for keyboard users. Relying on default browser outlines can lead to inconsistent experiences. Using `:focus-visible` ensures clear visibility for keyboard navigation without bothering mouse users.
**Action:** Always include `:focus-visible` styles for buttons and links in any embedded HTML templates, no matter how temporary the page might be.
