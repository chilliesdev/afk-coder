---
name: prd-implementation-reviewer
description: Review the project implementation against the requirements in PRD.md and generate a summary report. Use when you need a gap analysis or status update on feature completion without modifying code.
---

# PRD Implementation Reviewer

This skill guides you through auditing the codebase against `PRD.md` to ensure all requirements are met and correctly implemented.

## Workflow

1.  **Research**: Read `PRD.md` to identify all functional and non-functional requirements.
2.  **Audit**: Map the requirements to the current implementation in `src/`, `tests/`, and other relevant directories.
3.  **Report**: Generate a `REPORT.md` file summarizing the findings.

## Constraints

- **ReadOnly**: Do NOT implement fixes or modify existing code during the review process.
- **Deduplication**: Do NOT copy-paste content that already exists in other project artifacts (PRDs, ADRs, plans, etc.).
- **Referencing**: Always reference existing documents by their file path or URL.
- **Output**: Save the final assessment to `REPORT.md`.

## Report Structure

The `REPORT.md` should include:

1.  **Status Summary**: A high-level overview of implementation progress.
2.  **Requirements Traceability**: A list of requirements from `PRD.md` and their implementation status (Implemented, Partial, Missing).
3.  **Discrepancies**: Specific areas where the implementation deviates from the PRD.
4.  **Recommendations**: List of identified gaps or issues that need addressing (without implementing them).
5.  **References**: Links to relevant files, ADRs, or external docs.
