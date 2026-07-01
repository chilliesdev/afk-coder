
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2026-07-01 - Focus-Visible States on Inline HTML Templates
**Learning:** Even simple temporary HTML pages served locally for OAuth redirects benefit from basic accessibility styling. Adding `:focus-visible` ensures keyboard navigation outlines are present without cluttering the click interactions for mouse users.
**Action:** In CLI tools that launch local servers for callbacks, ensure default buttons get `:focus-visible` styling and a basic transition to feel polished rather than neglected.
