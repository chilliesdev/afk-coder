
## 2024-05-22 - Missing info due to early returns
**Learning:** Found a case where CLI output was skipping important info (Token Usage) due to an early `return` in an empty state check (no recent tasks).
**Action:** Replaced early return with `if/else` block to ensure all sections are printed even when some data is empty.
## 2024-05-18 - Local Inline Authentication Template Enhancements
**Learning:** When generating inline HTML for local authorization callback UI, users expect standard focus indicator behaviors to be explicitly declared, as browser default heuristics may drop visible outlines depending on interaction modes. The ':focus-visible' pseudo-class combined with offset and explicit transition is the cleanest way to support keyboard accessibility locally without bringing in a large external CSS dependency.
**Action:** Use ':focus-visible { outline: 2px solid [color]; outline-offset: 2px; }' (with proper transitions) across all minimalistic internal templates injected via node:http endpoints.
