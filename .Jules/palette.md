
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-07-03 - Accessible buttons in temporary inline templates
**Learning:** Even minimal inline HTML templates used for brief local interactions (like OAuth callback pages in CLI tools) are completely inaccessible via keyboard unless explicit focus states are added. The standard `.btn:hover` isn't enough.
**Action:** Added `.btn:focus-visible` with a 2px outline and offset, along with a subtle `transition`, directly in the inline `<style>` block to ensure keyboard users have clear feedback without visual noise for mouse users.
