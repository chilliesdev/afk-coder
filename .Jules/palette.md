
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2024-03-24 - [Add focus-visible to OAuth callback page]
**Learning:** Found a missing focus indicator for keyboard users in the local OAuth callback page (`src/cli/commands/login.ts`). Added `:focus-visible` styles with a solid outline and `outline-offset` instead of a plain `:focus` state to prevent visual noise for mouse users, along with CSS transitions for smoother visual feedback.
**Action:** Always check inline HTML templates (even temporary/local ones) for keyboard accessibility. Use `:focus-visible` over `:focus` to balance mouse and keyboard UX.
