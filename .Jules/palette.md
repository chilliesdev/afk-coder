## 2026-05-19 - CLI Empty States and Actionable Hints
**Learning:** CLI tools often return nothing (like an empty table) when there's no data, which leaves the user wondering if it worked.
**Action:** Always provide a clear, friendly "empty state" message explaining *why* there's no data and *what command to run next* (e.g. `💡 Tip: Start a new workflow with "afk-coder start <name>"`). Apply this same pattern of offering "next step" hints after successful actions (like giving the user the exact command to view logs after starting a background task).
