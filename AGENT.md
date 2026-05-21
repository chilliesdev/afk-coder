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
Ensure all code alignment matches the Domain Concepts documented in [CONTEXT.md](file:///Users/apple/Documents/afk-coder/CONTEXT.md):

### 3. Error Handling & Classifications
* Catch exceptions at the boundary layers and classify them correctly.
* In daemon code, map execution results to an `AgentOutcome` to determine operational actions (retry, next, fail).

### 4. Automated Testing
* Always write unit tests under the `tests/` directory for any new feature or bug fix.
* Run the test suite via `npm test` before committing changes.
* Verify that the codebase builds correctly using `npm run build`.