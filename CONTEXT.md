# Domain Context: Gemini AFK Coding Daemon

This document defines the core domain language used in the Gemini AFK Coding Daemon codebase.

## Core Concepts

- **Workflow** — A long-running autonomous process that coordinates execution across Coding and QA phases to achieve a goal defined in a PRD.
- **Coding Phase** — The phase in a Workflow where the Coder Agent resolves pending tasks in `tasks.md`.
- **QA Phase** — The phase in a Workflow triggered when all coding tasks are complete. A separate QA Agent is spawned in a new ExecutionRuntime sandbox to test the app externally as an end-user.
- **QA Cycle** — A single loop transition of Coding Phase -> QA Phase -> Coding Phase. If the QA Agent finds bugs or unmet requirements, it appends new tasks with PRD references, resetting the workflow to the Coding Phase. This cycle is capped to prevent infinite loops.
- **Task** — A single, actionable item within a workflow, typically represented as a line in a `tasks.md` file. In the QA Phase, new tasks must include a PRD requirement reference.
- **TaskBoard** — The module responsible for managing the lifecycle and reconciliation of **Tasks**.
- **TaskBoardStorage** — The storage seam (abstraction) that decouples **TaskBoard** state management from the file system, allowing in-memory adapters for testing.
- **Agent** — The module representing the autonomous Gemini agent. It can run in different roles (e.g., Coder Agent or QA Agent) and is responsible for prompt execution and task/issue generation within the **ExecutionRuntime**.
- **AgentOutcome** — A structured interpretation and operational decision-making model of an **Agent's** execution. It distills raw execution logs, exit codes, and task completion state changes into actionable decisions (retries, delay backoffs, and failure determinations) alongside token and error classifications.
- **ExecutionRuntime** — An isolated environment where the **Agent** operates. It provides a clean seam between the daemon and the underlying infrastructure (e.g., Docker).
- **WorkflowManager** — The central orchestrator that coordinates the **TaskBoard**, **ExecutionRuntime**, **Agent**, and **AgentOutcome** to drive a **Workflow** to completion.

