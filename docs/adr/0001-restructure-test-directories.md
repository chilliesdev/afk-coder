# Restructure Test Directories into Unit and Feature Categories

To support fast feedback loops and isolate integration complexities, we split the `tests/` directory into separate `unit/` and `feature/` test suites.

## Architectural Decision

1. **Strict 1-to-1 Mirroring**: The `tests/unit/` directory structure must strictly mirror the `src/` directory structure. For every source code file in `src/` that has unit tests, there should be exactly one corresponding test file in `tests/unit/` with the `.test.ts` suffix (e.g., `src/cli/ui.ts` maps to `tests/unit/cli/ui.test.ts`).
2. **Consolidation**: If a source file has multiple unit test files, they must be merged into a single test file matching the source file's name to preserve the 1-to-1 relationship.
3. **Seclusion of Helpers**: Shared test helper utilities, mock implementations, and manual verification scripts must reside under the common `tests/helpers/` directory and not under `tests/unit/`.
4. **Independent Suites**: We updated `package.json` scripts to allow running unit and feature tests independently or as a combined suite.
