
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.

## 2024-05-23 - Focus Visible Outline in Minimal Templates
**Learning:** For keyboard accessibility improvements on UI elements, including minimal inline HTML templates for CLI local callbacks, explicitly using `:focus-visible` with an outline and offset over a general `:focus` reduces visual noise for mouse users while keeping it completely accessible for keyboard navigators. Adding small `transition` effects also massively improves perceived polish for these temporary pages.
**Action:** Default to `:focus-visible` with `outline-offset: 2px` over generic `:focus` rings in temporary/inline HTML callbacks. Add `transition: all 0.2s ease-in-out` on interactive elements to elevate the feel of the UI.
