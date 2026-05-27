# PRD: CLI Format Log Output for Humans
**Triage Labels**: `ready-for-agent`

## Problem Statement

When running the `afk logs <workflow_name>` command, the CLI dumps raw Winston JSON log blocks (e.g., `{"level":"info","message":"Workflow executor started","timestamp":"..."}`) directly to the console. This raw format is difficult for human operators to read and parse visually, making debugging and monitoring workflows inefficient.

## Solution

Update the CLI's `logs` command to parse these JSON lines and format them into a structured, color-coded, and highly readable output. Standard ANSI escape codes will color-code levels (green for info, yellow for warn, red for error, and cyan for timestamps). We will also introduce `--json` and `--raw` flags to allow users to bypass formatting when piping logs to monitoring scripts, and automatically disable color formatting when output is redirected.

## User Stories

1. As an operator running `afk logs <workflow_name>`, I want to see log timestamps formatted cleanly as `[YYYY-MM-DD HH:mm:ss]`, so that I can easily tell when events occurred.
2. As an operator running `afk logs <workflow_name>`, I want the timestamps to be styled in cyan, so that they are visually distinguished from the rest of the log message.
3. As an operator running `afk logs <workflow_name>`, I want the log levels (e.g., `INFO`, `WARN`, `ERROR`) to be displayed in color-coded brackets, so that I can instantly identify critical warnings or errors.
4. As an operator running `afk logs <workflow_name>`, I want the `INFO` level to be green, so that it denotes a normal operating state.
5. As an operator running `afk logs <workflow_name>`, I want the `WARN` or `WARNING` level to be yellow, so that it alerts me to potential non-fatal issues.
6. As an operator running `afk logs <workflow_name>`, I want the `ERROR` level to be red, so that it highlights failures that need my immediate attention.
7. As an operator running `afk logs <workflow_name>`, I want any metadata other than the level, timestamp, message, and workflow name to be printed in a readable format, so that I don't lose context.
8. As an operator running `afk logs <workflow_name>`, I want small metadata fields (like `{ exitCode: 0 }`) to be printed inline in a neutral color (gray/reset), so that it keeps the log line concise.
9. As an operator running `afk logs <workflow_name>`, I want large or multiline metadata fields (such as agent outputs or error stacks) to be printed on new lines with proper indentation, so that the main log sequence remains easy to follow.
10. As an operator running `afk logs <workflow_name>`, I want any log lines that are not valid JSON to be printed as-is, so that I do not lose raw daemon logs or banners.
11. As an automated script piping logs (e.g., `afk logs my-workflow > output.log`), I want the CLI to automatically disable ANSI color codes when stdout is not a TTY, so that the log file is not cluttered with escape sequences.
12. As a DevOps engineer running log analysis tools, I want to use `afk logs <workflow_name> --raw` or `afk logs <workflow_name> --json` to receive the original JSON lines without any formatting, so that my log parsing scripts continue to function without modification.

## Implementation Decisions

- **CLI Log Formatting Layer**: Add a helper formatting function in the CLI module to parse, clean, and colorize the stream of JSON log lines.
- **Redundant Key Filtering**: Filter out `timestamp`, `level`, `message`, and `workflow` from the printed metadata object to avoid redundancy.
- **ANSI Color Support & Detection**: Define a basic terminal coloring map. Detect `process.stdout.isTTY` to automatically toggle colorization on/off.
- **CLI Command Options**: Update the `logs` command definition in `src/cli/index.ts` to accept `--raw` and `--json` flags.
- **Parsing Fallback**: Gracefully handle JSON parsing errors on a per-line basis, falling back to outputting the line as-is.

## Testing Decisions

- **Unit/Integration Tests**: Write unit/integration tests verifying the formatting helper under various conditions (standard JSON log, JSON log with metadata, multiline metadata, invalid JSON, and TTY/non-TTY simulation).
- **Target Modules**: The log formatter function in `src/cli/index.ts` (or a helper module in `src/cli/`).
- **Prior Art**: We have existing CLI tests in `tests/cli-connection.test.ts`.

## Out of Scope

- Modifying how the daemon stores the logs in the file system.
- Adding database/centralized log transport under this PRD.
- Interactive keyboard shortcuts or log filtering by levels directly in the CLI logs command (which is better suited for external tools like `grep`).

## Further Notes

None.
