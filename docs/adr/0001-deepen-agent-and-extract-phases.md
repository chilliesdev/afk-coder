# 1. Deepen Agent and Extract Workflow Phases

Date: 2026-05-22

## Status

Accepted

## Context

The `afk-coder` daemon coordinates execution between an autonomous Gemini Agent and an ExecutionRuntime sandbox. Previously, the `WorkflowManager` (and specifically its executor component) contained all control-flow logic in a monolithic, 250-line `runLoop` method. 

This executor managed the transitions between Coding and QA phases, but it also tightly coupled itself to the internal retry logic, error handling, token aggregation, and outcome analysis of the `Agent`. The `Agent` itself was a "shallow" module—it merely passed prompts through to the runtime, leaving the executor to handle all the operational complexities via an external `OutcomeAnalyzer`. This poor locality of behavior made the executor difficult to test, hard to reason about, and tricky for AI systems to navigate.

## Decision

We decided to apply the "Deep Modules" philosophy to address this architectural friction:

1. **Deepen the Agent Module**: The `Agent` now owns the `OutcomeAnalyzer` and its own retry, backoff, and safety filtering loops. It exposes clean, high-leverage interfaces (`executeCodingLoop` and `executeQALoop`) that return structured `AgentPhaseResult` objects.
2. **Extract Workflow Phases**: We established a strong seam by introducing the `WorkflowPhase` interface. The distinct responsibilities of the Coding Phase and QA Phase were extracted into `CodingPhaseAdapter` and `QaPhaseAdapter`.
3. **Simplify the Executor**: The `WorkflowExecutor` is now a pure state machine. It no longer contains task loop logic or error retry paths; it simply delegates to the active phase adapter and manages high-level transitions (e.g., transitioning between Coding and QA, tracking QA cycles).

## Consequences

### Positive
* **High Locality**: Agent execution logic, retries, and token aggregation are isolated in `Agent`, improving maintainability and testability.
* **Testability**: The `WorkflowExecutor` and phase adapters can be unit-tested without complex mocking of the underlying runtime output loops.
* **AI-Navigability**: Clear seams (`WorkflowPhase`) and deep modules (`Agent`) make it easier for AI agents to grasp the system's boundaries and propose targeted changes without breaking unrelated logic.

### Negative
* **Migration Overhead**: Tests relying on the previous tight coupling (e.g., resilience integration tests expecting specific synchronized log outputs) required refactoring to align with the new asynchronous execution profile and internal logging.
