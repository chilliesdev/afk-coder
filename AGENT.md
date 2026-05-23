## 🛠️ Code Style Guidelines

### 1. Early Return Pattern & Guard Clauses (Required)
Always prefer the **Early Return Pattern** and **Guard Clauses** over nested `if` statements or complex branching blocks. 
* **Precondition Checks:** Check validation, existence, error boundaries, or failure preconditions at the very beginning of a function and return or throw immediately.
* **Flatten Happy Path:** Keep the happy path at the root level of the function rather than nested inside `else` or conditional blocks.

*Example:*
```typescript
// Avoid this:
function process(item) {
  if (item) {
    if (item.isValid) {
      // happy path logic
    }
  }
}

// Do this instead:
function process(item) {
  if (!item) return;
  if (!item.isValid) return;

  // happy path logic
}
```

### 2. Domain Alignment
Ensure all code alignment matches the Domain Concepts documented in [CONTEXT.md](file:///home/kayodematthew/afk-coder/CONTEXT.md).

### 3. Error Handling & Classifications
* Catch exceptions at the boundary layers and classify them correctly.
* In daemon code, map execution results to an `AgentOutcome` to determine operational actions (retry, next, fail).

### 4. Automated Testing
* Always write unit tests under the `tests/` directory for any new feature or bug fix.
* Run the test suite via `npm test` before committing changes.
* Verify that the codebase builds correctly using `npm run build`.

### 5. SOLID Principles (Required)
Always adhere to the **SOLID** design principles to maintain a clean, modular, and highly testable architecture:
* **Single Responsibility Principle (SRP):** Each class/module must have a single, well-defined responsibility. For example, [TaskValidator](file:///home/kayodematthew/afk-coder/src/common/validation.ts) is solely responsible for task formatting rules, while [TaskBoard](file:///home/kayodematthew/afk-coder/src/daemon/task-board.ts) manages task lifecycle state.
* **Open/Closed Principle (OCP):** Code should be open for extension but closed for modification. Implement new behaviors (e.g., new [WorkflowPhase](file:///home/kayodematthew/afk-coder/src/daemon/workflow-phase.ts) types) by introducing new phase adapters rather than editing the core [WorkflowExecutor](file:///home/kayodematthew/afk-coder/src/daemon/workflow-executor.ts).
* **Liskov Substitution Principle (LSP):** Subtypes must be completely substitutable for their base types/interfaces without changing the correctness of the program. Any implementation of [AgentAdapter](file:///home/kayodematthew/afk-coder/src/daemon/agent-adapter.ts) (e.g., Gemini, Aider) must adhere to the contract defined by the base interface.
* **Interface Segregation Principle (ISP):** Clients should not be forced to depend on methods they do not use. Prefer small, highly focused interfaces (like [TaskBoardStorage](file:///home/kayodematthew/afk-coder/src/daemon/task-storage.ts)) over large, monolithic ones.
* **Dependency Inversion Principle (DIP):** Depend on abstractions (interfaces), not concretions. For example, [TaskBoard](file:///home/kayodematthew/afk-coder/src/daemon/task-board.ts) must depend on the [TaskBoardStorage](file:///home/kayodematthew/afk-coder/src/daemon/task-storage.ts) interface rather than directly on the local filesystem, enabling seamless in-memory testing.