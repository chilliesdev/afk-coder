
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-23 - Focus states in inline HTML templates
**Learning:** Found that temporary inline HTML templates (like those used for OAuth callbacks) were missing proper keyboard focus styles, reducing accessibility for keyboard users closing the window.
**Action:** Added explicit `:focus-visible` CSS rules with `outline` and `transition` properties directly in the template literal to ensure consistent keyboard focus visibility.
