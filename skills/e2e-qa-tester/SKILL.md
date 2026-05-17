---
name: e2e-qa-tester
description: Performs end-to-end testing based on PRD.md by simulating user behavior. Use this skill when you need a comprehensive QA audit, regression testing, or verification of features against requirements without modifying the code.
---

# E2E QA Tester

This skill enables a systematic, user-centric testing workflow. It focuses on identifying discrepancies between the current implementation and the requirements defined in `PRD.md`.

## Core Principles

- **End-User Perspective:** Always simulate usage from the perspective of an end user (e.g., running CLI commands, interacting with APIs, checking logs).
- **Zero-Fix Policy:** Do NOT attempt to fix any issues found during the testing phase. Your sole responsibility is to document them.
- **Evidence-Based:** Every failure or bug reported must include logs, error messages, or clear steps to reproduce.
- **Artifact Management:** Always delete all test artifacts (temporary files, test databases, logs created during testing) immediately after the test run is complete and the report is generated.

## Workflow

### 1. Requirements Analysis
Read `PRD.md` to identify all functional and non-functional requirements. List the key features and user flows that need verification.

### 2. Environment Setup
- Verify the project builds successfully (`npm run build`, `make`, etc.).
- Ensure all dependencies are installed.
- Identify the entry points (e.g., CLI binaries in `bin/`, main scripts).

### 3. Execution & Simulation
For each requirement/user flow:
- **Simulate:** Run the actual software as a user would.
- **Observe:** Check the output against the "Expected Behavior" in `PRD.md`.
- **Verify:** Look for edge cases, error handling, and performance issues.

### 4. Reporting
Generate a detailed report in `QA_REPORT.md` following the template in `references/QA_REPORT_TEMPLATE.md`.

### 5. Cleanup
Immediately after generating the `QA_REPORT.md`, identify and delete all temporary files, logs, test directories, or other artifacts created during the simulation phase to leave the workspace in its original state.

## Guidelines for QA_REPORT.md

- **Severity Levels:**
    - **Critical:** Crashes, data loss, or core functionality completely broken.
    - **Major:** Significant feature not working as expected, but workarounds might exist.
    - **Minor:** UI glitches, confusing messages, or non-critical feature issues.
    - **Trivial:** Typographical errors, minor styling issues.
- **Reproducibility:** If an issue is intermittent, note it clearly.

## Resources

- **references/QA_REPORT_TEMPLATE.md**: Use this template for the final report to ensure consistency and completeness.
