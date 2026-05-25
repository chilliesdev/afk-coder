# PRD: CLI Init Command Progress Feedback
**Triage Labels**: `ready-for-agent`

## Problem Statement

When running the `init` command, the user experiences a complete lack of feedback once the initial generation message (`Generating tasks.md from PRD.md via Gemini AFK Daemon...`) is printed. The task generation process takes several seconds (usually between 10 to 30 seconds depending on sandbox startup and Gemini generation speed). To the user, it feels as if the command has frozen or hung, creating a poor user experience.

## Solution

Provide a step-by-step progress feedback mechanism in the CLI during the `init` command execution. We will stream key progress milestones from the daemon to the CLI client over the control socket using a Newline-Delimited JSON (NDJSON) stream. The CLI will display a clean, lightweight terminal spinner for each step, checking them off when done.

## User Stories

1. As an operator running `afk-coder init`, I want to see immediate feedback that the client has connected to the daemon, so that I know the request was successfully transmitted.
2. As an operator running `afk-coder init`, I want to see a spinner indicating when the execution runtime (Docker sandbox) is starting up, so that I understand why the command hasn't immediately finished.
3. As an operator, I want the Docker startup step to turn into a green checkmark once complete, so that I know the sandbox environment is ready.
4. As an operator, I want to see a spinner indicating that the Gemini AI model is currently reading the PRD and generating the task checklist, so that I am aware the AI is actively processing my requirement document.
5. As an operator, I want the task generation step to show a success state once Gemini has finished generating the tasks, so that I can track the progress of the workflow.
6. As an operator, I want to see a spinner indicating that the generated tasks are being validated, so that I know the daemon is verifying the task formats before saving.
7. As an operator, I want to see a final confirmation message and a clean checkmark when the `tasks.md` file is successfully written, so that I know the command completed successfully.
8. As an operator, if the sandbox fails to start, I want the active step to show a failure cross, and the CLI to output the appropriate error details, so that I can troubleshoot the issue.
9. As an operator, if the Gemini generation fails, I want the CLI to report the failure step and output the logs, so that I can see what went wrong inside the container.
10. As a developer modifying or running other commands (like `start`, `status`, `logs`), I want the socket connection logic to remain completely backward-compatible, so that existing daemon workflows are not broken.

## Implementation Decisions

- **Daemon-to-CLI Streaming Protocol**: Use Newline-Delimited JSON (NDJSON) over the existing UNIX domain socket. The daemon will send intermediate progress events as single-line JSON objects before writing the final command response.
- **Daemon Milestone Reporting**: The `init` handler in the daemon and the `Agent.generateTasks()` method will be updated to accept an optional callback to publish milestone progress.
- **CLI Connection Upgrades**: The CLI client's `sendCommand` utility will be modified to support a callback that streams status events by chunking the incoming data stream on newline characters.
- **Terminal UI Rendering**: The CLI will use a lightweight, zero-dependency spinner to show a clean spinner animation for the active step. When a milestone changes, the current spinner line is checked off with a green checkmark (or red cross on failure) and the next step spinner begins.

## Testing Decisions

- **External Behavior Testing**: The tests should verify that the CLI correctly renders status changes, and the client properly parses multiple newline-delimited status updates followed by a final response.
- **Target Modules**: `DaemonClient` and the `init` command handler in `src/cli/index.ts`.
- **Prior Art**: We have existing tests for the CLI client socket connection in `tests/cli-connection.test.ts` and `tests/daemon-socket.test.ts`. We will add tests simulating socket streams containing newline-separated status events.

## Out of Scope

- Interactive terminal dashboard overlays or fullscreen TUI.
- Adding complex node-module terminal libraries to keep dependencies minimal.
- Adding streaming updates to other daemon commands under this scope.

## Further Notes

- The implementation must ensure that any socket closure or connection error during streaming is handled gracefully, cleaning up terminal cursor visibility.
