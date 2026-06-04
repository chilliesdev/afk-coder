
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2024-05-14 - Focus-Visible Pattern for Temporary HTML Templates
**Learning:** When making accessibility improvements to inline HTML strings (like OAuth callbacks) where CSS is restricted to a single `<style>` block, `:focus-visible` is highly effective. It avoids requiring JavaScript or complex CSS selectors, while providing clear keyboard focus without impacting mouse users.
**Action:** Use `.btn:focus-visible` for keyboard accessibility in temporary, server-rendered views. When writing Playwright verification tests for inline HTML, extract the template string via a regex, write it to a local file, and access it with `page.goto('file://...')` instead of attempting to mock the entire local web server.
