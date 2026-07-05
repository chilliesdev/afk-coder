
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-11-20 - Focus Visible in Inline Templates
**Learning:** For keyboard accessibility improvements on UI elements in minimal inline HTML templates (like OAuth callbacks), it's important to explicitly use `:focus-visible` with an outline and offset (alongside standard hover states and transitions) over a general `:focus` to reduce visual noise for mouse users while ensuring keyboard navigability.
**Action:** Applied this pattern to the `.btn` class in `src/cli/commands/login.ts` and noted it for future similar templates.
