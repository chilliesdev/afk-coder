
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-22 - Enhance keyboard accessibility on temporary auth pages
**Learning:** Temporary or embedded HTML pages (like local OAuth callbacks) often miss out on accessibility features found in the main app's design system. Adding explicit `:focus-visible` states to buttons here improves keyboard navigation without introducing visual noise for mouse users.
**Action:** Always add explicit `:focus-visible` outline styles with offset, alongside standard hover states, even in minimal inline HTML templates.
