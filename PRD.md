# PRD: Single Container Execution Runtime for Workflows

## Problem Statement

Currently, the `afk-coder` daemon creates a new Docker container (execution runtime) for every single loop execution in a workflow. Spawning a new container is slow, incurs substantial CPU/memory overhead on startup and teardown, and prevents efficient command execution caching or continuous environment preservation during the workflow lifecycle.

## Solution

Optimize the daemon's sandbox manager to create a single persistent Docker container at the start of a workflow and keep it alive until the workflow finishes. During the workflow, run agent loops inside this single running container using `docker exec` sessions instead of instantiing a brand new container every time.

## User Stories

1. As a developer running a workflow, I want the daemon to instantiate a single persistent container on startup, so that subsequent tasks run faster and consume fewer system resources.
2. As a developer, I want the execution runtime to support explicit startup and shutdown methods, so that the workflow controller has precise control over the container's lifecycle.
3. As a developer, I want agent commands to execute via `docker exec` inside the active container, so that task execution overhead is minimized.
4. As a developer, I want logs from exec runs to be streamed and demuxed correctly, so that I have access to clean, unpolluted output logs from the agent commands.
5. As a developer running multiple concurrent workflows, I want each workflow to have its own isolated container, so that there are no namespace, port, or workspace conflict issues.
6. As a developer, I want all execution logic (including standalone command task generation `init`) to explicitly manage the container lifecycle through `start()` and `stop()` calls, so that we do not rely on launching temporary fallback containers.
7. As a developer, I want the container to be automatically killed and cleaned up if the workflow is aborted or killed, so that no orphaned containers are left running on the host system.

## Implementation Decisions

- **ExecutionRuntime Interface Enhancement**: Add optional `start(dir, configDir)` and `stop()` methods to the `ExecutionRuntime` interface. This ensures backward compatibility for runtimes or mocks that do not implement them.
- **DockerRuntime Optimization**:
  - Implement the `start` method to create and start a single container running a long-lived command (`tail -f /dev/null`) with the required binds, env variables, and resources constraints.
  - Implement `stop` to clean up temporary setting files and kill/remove the container.
  - Implement exec-based `run` behavior: if `start` has run and the container is active, use `dockerode`'s `container.exec` api to run the command inside it. Otherwise, throw an error.
  - For exec execution, collect output buffers from the stream and parse/demux them using the standard Docker 8-byte framing structure, then query the exec session for the final exit code.
- **Agent Lifecycle Integration**: Expose `start` and `stop` on the `Agent` class to delegate to the underlying runtime. Call `stop` in the agent's `kill()` handler. Standalone commands (like `generateTasks`) must explicitly wrap execution in `start` and `stop` blocks.
- **Workflow Executor Integration**: Update the workflow executor's main loop to call `agent.start()` at initialization, and run `agent.stop()` in a `finally` block to guarantee container cleanup.
- **Agent Factory Scoping**: Modify the daemon's `agentFactory` to instantiate `DockerRuntime` per-agent instead of using a global singleton, isolating sandbox containers for different workflows.

## Testing Decisions

- **Unit Testing the Lifecycle**: Introduce unit tests in a dedicated suite to verify that:
  - Calling `start()` boots the container with the correct arguments.
  - Calling `run()` when started delegates execution to `container.exec` and successfully demuxes the logs.
  - Calling `stop()` cleans up the running container.
- **Integration & Regression Testing**: Ensure all existing tests (including runtime tests, workflow executor tests, and status tests) compile and pass successfully, aligning them to verify the persistent container lifecycle instead of any fallback paths.
- **Prior Art**: Refer to `tests/runtime-docker.test.ts` for mocking Dockerode container management.

## Out of Scope

- Persisting container state across daemon daemon crashes or system reboots.
- Running concurrent overlapping exec processes within the same container session (execution remains sequential).

## Further Notes

- Triage Label: `ready-for-agent`
