
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-23 - Keyboard Accessibility in Temporary HTML Templates
**Learning:** Even simple, temporary, locally-served HTML pages (like OAuth callback handlers embedded inside node scripts) require robust accessibility. Since these handlers often only present a single button (e.g. "Close Window"), users relying on keyboard navigation need clear indication when the button receives focus.
**Action:** Used `:focus-visible` to add a highly visible focus ring to the `.btn` class within inline HTML templates. This ensures keyboard users can see where they are, while avoiding an unnecessary focus ring when mouse users click the button.
