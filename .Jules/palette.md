
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2026-06-15 - Focus-Visible in Minimal HTML
**Learning:** When creating minimal, inline HTML templates (like OAuth callbacks) where typical CSS frameworks are absent, explicit `:focus-visible` with an outline and offset (e.g., `outline: 2px solid #2563eb; outline-offset: 2px;`) is critical to preserve keyboard accessibility without introducing visual noise for mouse users.
**Action:** Add `:focus-visible` states and standard transition properties to all interactive elements in minimal/temporary HTML templates to support keyboard users effectively.
