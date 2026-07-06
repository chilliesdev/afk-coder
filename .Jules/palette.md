
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2026-07-06 - Accessible OAuth callback buttons
**Learning:** Temporary local HTML servers for OAuth flows often omit basic accessibility properties on buttons (like `transition` and `focus-visible`) because they are "just temporary templates". This reduces the polish of the workflow for keyboard users.
**Action:** When working with inline HTML templates string-literals in Node.js, apply standard CSS pseudo-classes (`:hover`, `:focus-visible`) directly in the `<style>` block to maintain consistent accessibility.
