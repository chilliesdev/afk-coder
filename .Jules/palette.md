
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-23 - Add Focus Visible State to OAuth Callback Button
**Learning:** Found that custom buttons inside basic HTML templates (like the OAuth callback page) often miss default browser focus states when custom background colors and borders are applied, making keyboard navigation less apparent.
**Action:** Always add explicit `:focus-visible` styles with a clear visual indicator (like a box-shadow ring) and a smooth transition when styling buttons in raw HTML templates to ensure accessibility for keyboard users.
