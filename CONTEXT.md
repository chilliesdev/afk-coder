# Domain Context: Gemini AFK Coding Daemon

This document defines the core domain language used in the Gemini AFK Coding Daemon codebase.

## Core Concepts

- **Workflow** — A long-running autonomous process that executes a set of tasks to achieve a goal defined in a PRD.
- **Task** — A single, actionable item within a workflow, typically represented as a line in a `tasks.md` file.
- **TaskBoard** — The module responsible for managing the lifecycle and reconciliation of **Tasks**.
- **TaskBoardStorage** — The storage seam (abstraction) that decouples **TaskBoard** state management from the file system, allowing in-memory adapters for testing.
- **Agent** — The module representing the autonomous Gemini agent. It is responsible for prompt execution and task generation within the **ExecutionRuntime**.
- **AgentOutcome** — A structured interpretation and operational decision-making model of an **Agent's** execution. It distills raw execution logs, exit codes, and task completion state changes into actionable decisions (retries, delay backoffs, and failure determinations) alongside token and error classifications.
- **ExecutionRuntime** — An isolated environment where the **Agent** operates. It provides a clean seam between the daemon and the underlying infrastructure (e.g., Docker).
- **WorkflowManager** — The central orchestrator that coordinates the **TaskBoard**, **ExecutionRuntime**, **Agent**, and **AgentOutcome** to drive a **Workflow** to completion.
