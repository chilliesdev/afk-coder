---
name: delegate-to-afk
description: Coordinates with the afk-coder daemon to execute background tasks autonomously.
---

# Delegate to AFK

This skill allows any agent to offload long-running coding and testing tasks to the local autonomous agent daemon (`afk-coder`).

## When to Delegate

Delegate a task or workflow when:
- The task is large, complex, or requires editing multiple files.
- The task requires a full cycle of coding, building, and running end-to-end QA tests.
- You want to run the workflow in the background autonomously without blocking the user session.

## How to Delegate

To delegate a task, follow these steps:

1. **Initialize the Task Board**
   Run the following command to generate the `tasks.md` file from a PRD file (defaults to `PRD.md`):
   ```bash
   afk init --prd PRD.md
   ```
   This will analyze the PRD and create a structured checklist of granular tasks in `tasks.md`.

2. **Start the Autonomous Workflow**
   Start the `afk-coder` daemon workflow:
   ```bash
   afk start <workflow_name>
   ```
   If you want to isolate the execution using a Git worktree and a separate branch:
   ```bash
   afk start <workflow_name> --worktree --branch <branch_name>
   ```

3. **Monitor Progress**
   Check the status of running workflows at any time:
   ```bash
   afk list
   ```

## Post-Delegation

Once the autonomous workflow starts:
1. Provide the user with the workflow name and instructions on how they can monitor or stop it.
2. Gracefully stop your current task execution or output a summary indicating that delegation has completed successfully.
