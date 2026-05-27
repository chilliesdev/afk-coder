
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2024-05-27 - Added Focus States and Semantic Landmarks to OAuth Callback UI
**Learning:** Even temporary/local HTML pages (like OAuth callbacks) benefit from keyboard accessibility focus indicators (`:focus-visible`) and semantic landmarks (`aria-labelledby` on `<main>`). These are often overlooked in CLI tools.
**Action:** Always include focus states and basic landmark ARIA attributes in any embedded HTML template, no matter how briefly it is displayed.
