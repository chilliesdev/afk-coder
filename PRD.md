# Product Requirements Document (PRD): Gemini AFK Coding Daemon

## 1. Product Overview

The **Gemini AFK Coding Daemon** is a background-managed, autonomous coding assistant tailored for Ubuntu servers. It is implemented in **TypeScript** and leverages the Gemini CLI (powered by the Gemini 2.5 Pro model) to execute software development tasks continuously. The system utilizes **Google OAuth 2.0** as its primary authentication mechanism, allowing it to leverage the user's **Google AI Pro subscription** securely. The system relies on human-in-the-loop (HITL) task generation, followed by a fully autonomous execution loop enclosed within a secure, root-privileged sandbox.

## 2. Goals & Objectives

* **Autonomy:** Enable fire-and-forget task execution.
* **Security:** Execute all LLM-driven shell commands and code modifications inside an isolated sandbox with internal root access, protecting the host Ubuntu system.
* **Native Experience:** Provide a seamless Linux daemon experience (similar to `systemd` services) with simple CLI commands for process management.
* **Traceability:** Maintain comprehensive, structured logs for every action, prompt, and output the model generates.

---

## 3. Core Workflow

### 3.1. Phase 1: Preparation (HITL)

1. **PRD Generation:** User generates or writes a `PRD.md`.
2. **Task Extraction:** User leverages a prompt/skill to break `PRD.md` down into a structured `tasks.md` file (e.g., using `- [ ] Task description`).
3. **Validation:** The system validates `tasks.md` format before allowing execution.

### 3.2. Phase 2: Execution (AFK Loop)

1. User initiates the workflow via the CLI `start` command.
2. The daemon spins up a sandboxed environment (e.g., using `Docker` or `systemd-nspawn`) mapped to the implementation directory.
3. **The Loop:**
* Parse `tasks.md` to find the first uncompleted task (`- [ ]`).
* Construct the prompt: *"Pick the most priority task in the tasks.md, and focus only on that task, mark the task as done and end the session."*
* Invoke Gemini CLI in the sandbox.
* Capture standard output, standard error, and token usage.
* Verify if `tasks.md` was updated (task marked as `- [x]`).
* Repeat until all tasks are marked complete or a fatal error threshold is reached.



---

## 4. Functional Requirements

### 4.1. CLI Commands & Interface

The application must expose a main command-line interface (e.g., `afk-coder`).

* **`afk-coder init [--dir <path>]`**
* Automatically generates a `tasks.md` from a `PRD.md` in the specified directory.
* Leverages Gemini to extract granular, actionable implementation tasks.


* **`afk-coder login`**
* Initiates the Google OAuth 2.0 flow (requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` environment variables to be set).
* Exchanges the authorization code for access and refresh tokens.
* Securely stores tokens for use by the background daemon.


* **`afk-coder start <workflow_name> [--dir <path>]`**
* Validates the presence and format of `PRD.md` and `tasks.md`.
* If `--dir` is not specified, creates a default implementation directory (e.g., `./<workflow_name>_impl`).
* Detaches from the terminal and hands over execution to the background daemon.


* **`afk-coder list`**
* Outputs a table of running workflows.
* *Columns:* Workflow Name, PID, Uptime, Progress (e.g., 4/10 Tasks), Implementation Dir, Status (Running/Failed/Done).


* **`afk-coder kill <workflow_name>`**
* Gracefully terminates the sandboxed process and the background loop.


* **`afk-coder logs <workflow_name> [--tail | -f]`**
* Streams or outputs the execution logs for the specified workflow.



### 4.2. Sandboxing Engine

* The environment must allow the Gemini CLI full root (`sudo`) privileges *within* the sandbox so it can install dependencies, modify environments, and compile code.
* The implementation directory and the `tasks.md` must be mounted into the sandbox.
* Network access must be enabled for dependency fetching and API communication.

### 4.3. Logging System

* **Format:** Structured logging (JSON or highly readable logfmt).
* **Required Data Points:**
* Workflow Name
* Timestamp (ISO 8601)
* Current Task ID / Name
* Raw Model Prompt
* Raw Model Output (stdout/stderr)
* Sandbox environment state changes (if detectable)



---

## 5. System Architecture

The system will consist of three primary components:

1. **The CLI Client:** A TypeScript/Node.js frontend that interacts with the user, parses arguments, and communicates with the Daemon.
2. **The Service Daemon:** A `systemd`-managed Node.js process that queues workflows, manages state, monitors progress, handles Google OAuth 2.0 authentication, and exposes a Unix socket or local port for the CLI client to query.
3. **The Execution Sandbox:** Ephemeral, isolated containers, using `Docker` spun up by the Daemon for each workflow.

### 5.1. Authentication & Authorization

* **Mechanism:** Google OAuth 2.0 (Authorization Code Flow with PKCE for CLI or Device Flow).
* **Subscription Integration:** The OAuth flow will authenticate the user's Google account to access Gemini Pro models under their subscription.
* **Token Management:** The Daemon will securely store and refresh OAuth tokens to maintain continuous operation.

### Architecture Diagram Details (Conceptual)

* **Input:** `PRD.md` + `tasks.md`
* **Control Plane:** `afk-coder CLI` <--> `Unix Domain Socket` <--> `afk-coder-daemon (systemd)`
* **Data Plane:** `Daemon` spawns `Sandbox (root)`. Sandbox runs `Gemini CLI (Loop)`. Sandbox writes to `Logs (Host)` and `Implementation Dir (Host)`.

---

## 6. Non-Functional Requirements

* **Resilience:** If the Gemini API rate limits or times out, the daemon should implement exponential backoff rather than failing the entire workflow.
* **Resource Limits:** Each sandbox should have configurable CPU and Memory limits to prevent runaway LLM-generated code (e.g., infinite loops or fork bombs) from crashing the Ubuntu host.
* **Security:** Ensure the host system's root filesystem is mounted as read-only or strictly completely isolated from the sandbox.

---

## 7. Packaging & Installation

To meet the requirement of functioning like any other Linux service without worrying about background management:

* **Distribution:** Packaged as a `.deb` file for Ubuntu.
* **Installation Actions:**
1. Installs the `afk-coder` binary to `/usr/local/bin/`.
2. Installs the `afk-coder-daemon` to `/usr/local/bin/`.
3. Creates a `systemd` service file at `/etc/systemd/system/afk-coder.service`.
4. Automatically enables and starts the service (`systemctl enable --now afk-coder.service`).


* **Dependencies:** The package manager will automatically pull required dependencies (e.g., `docker.io`, `jq` for JSON parsing, etc.).
