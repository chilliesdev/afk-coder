# Domain Context: Gemini AFK Coding Daemon

This document defines the core domain language used in the Gemini AFK Coding Daemon codebase.

## Core Concepts

- **Workflow** — A long-running autonomous process that executes a set of tasks to achieve a goal defined in a PRD.
- **Task** — A single, actionable item within a workflow, typically represented as a line in a `tasks.md` file.
- **TaskBoard** — The module responsible for managing the lifecycle and persistence of **Tasks**. It translates the raw state of a project (e.g., `tasks.md`) into a high-level API for the **WorkflowManager**.
- **Agent** — The autonomous Gemini CLI process running inside the **ExecutionRuntime**.
- **AgentOutcome** — A structured interpretation and operational decision-making model of an **Agent's** execution. It distills raw execution logs, exit codes, and task completion state changes into actionable decisions (retries, delay backoffs, and failure determinations) alongside token and error classifications.
- **ExecutionRuntime** — An isolated environment where the **Agent** operates. It provides a clean seam between the daemon and the underlying infrastructure (e.g., Docker).
- **AgentStrategy** — The set of instructions and prompts provided to the **Agent** to guide its autonomous behavior.
- **TaskGenerator** — The module responsible for generating a `tasks.md` file from a PRD (e.g., `PRD.md`) by executing the task generation agent strategy within the execution runtime.
- **WorkflowManager** — The central orchestrator that coordinates the **TaskBoard**, **ExecutionRuntime**, and **AgentOutcome** to drive a **Workflow** to completion.
