
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2026-06-24 - Inline HTML Button Focus Outline
**Learning:** For minimal inline HTML templates serving OAuth flows, relying only on `:hover` leaves keyboard users without clear feedback. Standard `:focus` can be visually noisy for mouse clicks.
**Action:** Use `:focus-visible` to add an outline and `outline-offset` to buttons. Also add a standard `transition: all 0.2s ease;` to soften the state changes.
