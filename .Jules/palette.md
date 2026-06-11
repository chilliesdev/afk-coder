## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-28 - Focus Styles for Temporary HTML UI
**Learning:** Even bare-bones, temporary HTML pages (like OAuth callbacks served locally) need proper keyboard accessibility. Buttons must have `:focus-visible` styles so screen reader and keyboard users know when the element is focused.
**Action:** Always add `:focus-visible { outline: 2px solid [color]; outline-offset: 2px; }` and smooth transitions to interactive elements in injected HTML strings.
