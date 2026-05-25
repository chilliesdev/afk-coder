# Gemini AFK Coding Daemon (`afk`)

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Platform: Ubuntu](https://img.shields.io/badge/Platform-Ubuntu-orange.svg)](https://ubuntu.com/)

An autonomous, background-managed coding assistant for Ubuntu servers. `afk` leverages the power of Gemini 2.5 Pro via the Gemini CLI to execute software development tasks continuously in a secure, isolated sandbox.

## 🚀 Overview

The **Gemini AFK Coding Daemon** is designed for "fire-and-forget" task execution. It takes a high-level Product Requirements Document (PRD), breaks it down into actionable tasks, and then enters an autonomous loop where it implements, tests, and validates each task within a Docker sandbox.

### Key Pillars
- **Autonomy:** Continuous execution until all tasks in `tasks.md` are marked complete.
- **Security:** Root-privileged execution isolated within Docker containers to protect the host system.
- **Native Integration:** Runs as a standard Linux daemon (`systemd`), manageable via a familiar CLI.
- **Traceability:** Detailed logs of every prompt, model response, and sandbox action.

---

## 🛠️ Architecture

The system consists of three main components:

1.  **CLI Client (`afk`):** The user interface for managing workflows, viewing logs, and initializing projects.
2.  **Service Daemon (`afk-coder-daemon`):** A `systemd`-managed background process that handles task queuing, Google OAuth 2.0 authentication, and sandbox management.
3.  **Execution Sandbox:** Ephemeral Docker containers where the Gemini CLI executes code modifications, installations, and tests with full internal root access.

---

## 📦 Installation

### Prerequisites
- **OS:** Ubuntu (or Debian-based distribution)
- **Node.js:** v18+ 
- **Docker:** Installed and running (the Gemini CLI runs inside the sandbox container, so no host-side Gemini CLI installation is required)

### Setup
Run the provided installation script:

```bash
chmod +x install.sh
./install.sh
```

This script will:
1. Build the project.
2. Install binaries to `/usr/local/bin/`.
3. Register and enable the `afk-coder.service` systemd unit, dynamically configured to run under the user and group of the account executing the installer.

### User Access & Permissions
Since the daemon runs as the logged-in user who ran the installation script, it naturally inherits all of your user's permissions and has full read/write access to your home directory, active workspaces, and git repositories.

**Docker Access:** Ensure your user is a member of the `docker` group so the daemon can run sandboxed containers:
```bash
# The installation script will attempt to add you automatically if you are not already a member
sudo usermod -aG docker $USER
# Log out and back in for changes to take effect
```

Finally, start the daemon:
```bash
sudo systemctl start afk-coder
```

---

## ⚙️ Configuration

You can configure `afk-coder` using environment variables or a configuration file.

### Environment Variables
For secure credentials management, you can provide your Google Cloud OAuth credentials or API key via environment variables. Create a `.env` file by copying the example:
```bash
cp .env.example .env
```
Fill in your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the `.env` file. These values take precedence over the configuration file.

Alternatively, you can authenticate using a Gemini API Key. Export the `GEMINI_API_KEY` on your host environment or inside `.env`:
```bash
export GEMINI_API_KEY="your-api-key-here"
```
The daemon will automatically detect and forward this key to the sandboxed runtime, bypassing OAuth setup.

#### Additional Environment Variables
*   `AFK_CODER_SOCKET`: Override the default Unix socket path (`/tmp/afk-coder.sock`) used to communicate between the CLI and Daemon.
*   `GEMINI_CLI_AUTH_METHOD` & `GEMINI_PROJECT_ID`: If set on the host, these variables are forwarded to the sandboxed runtime container to customize the Gemini CLI configuration.

### Configuration File
You can customize the daemon and sandbox behavior by editing `~/.config/afk-coder/config.json`.

| Key | Default | Description |
| :--- | :--- | :--- |
| `daemon.socketGroup` | `"afk-coder-users"` | The Unix group that will own the control socket. |
| `daemon.socketPath` | `"/tmp/afk-coder.sock"` | The path to the daemon's control socket. |
| `daemon.agent` | `"gemini"` | The default agent adapter to use for tasks (e.g., `"gemini"`, `"aider"`). |
| `sandbox.image` | `"us-docker.pkg.dev/gemini-code-dev/gemini-cli/sandbox:0.41.0"` | The Docker image used for the execution sandbox. |
| `sandbox.memory` | `2147483648` | Memory limit for the sandbox (bytes). |
| `sandbox.nanoCpus` | `2000000000` | CPU limit for the sandbox (nano CPUs). |
| `auth.redirectUri` | `"http://localhost:3000"` | The redirect URI for the OAuth 2.0 flow. |

---

## 🚦 Usage

### 1. Initialize a Project
Create a `PRD.md` in your project directory, then generate a `tasks.md`:

```bash
# Runs in the current directory, looking for PRD.md
afk init

# Or specify a custom directory and overwrite existing tasks.md
afk init --dir /path/to/project --prd custom-PRD.md --force
```
**Note:** The `init` command requires authentication. Please run `afk login` first or set the `GEMINI_API_KEY` environment variable.

### 2. Authentication
Log in to your Google account to enable Gemini Pro access. Ensure your OAuth credentials are set via the `.env` file or configuration file before logging in:

```bash
afk login
```

**Remote/Headless Servers:**
If you are running the CLI on a remote server without a web browser, the local callback server on port 3000 won't be able to open a browser window automatically. To complete login:
1. Open the generated authorization URL on your local machine's web browser.
2. Complete the OAuth flow.
3. The browser will redirect to `http://localhost:3000/` (which may fail to load locally). Copy the full redirect URL containing `?code=...` from the browser's address bar.
4. Paste the URL directly into the CLI prompt: `If running on a remote server, paste the redirect URL here:` and press Enter.

**Troubleshooting:** If you encounter an `EADDRINUSE` error (port 3000 is occupied), free the port by running `npx kill-port 3000` and try logging in again.

### 3. Start a Workflow
Kick off the autonomous coding loop. If `--dir` is not specified, it will run in the current directory.
```bash
afk start my-feature --dir /path/to/project
```
To run the workflow in an isolated git worktree, use the `-w` or `--worktree` flag. If `--dir` and `--branch` are not provided, they will be automatically generated with a random suffix based on the workflow name to avoid conflicts:
```bash
afk start my-feature -w
# This creates a worktree directory like ./my-feature-5a1b3c and a branch named my-feature-5a1b3c
```
You can also explicitly specify the branch and directory if desired:
```bash
afk start my-feature -w --branch my-feature-branch --dir /path/to/worktree
```
To specify a different agent adapter (e.g., `aider`), use the `--agent` option:
```bash
afk start my-feature --agent aider
```

### 4. Monitor Progress
Check the status of running workflows or view live logs:

```bash
afk list
afk status my-feature
afk logs my-feature -f
```

---

## ⌨️ CLI Reference

| Command | Description |
| :--- | :--- |
| `init [--dir <path>] [--prd <filename>] [--force]` | Extracts tasks from a PRD file into `tasks.md` using a Docker sandbox. `--dir` defaults to `.`, and `--prd` defaults to `PRD.md`. Use `--force` to overwrite existing `tasks.md`. |
| `login` | Performs Google OAuth 2.0 flow. |
| `start <name> [--dir <path>] [-w\|--worktree] [--branch <name>] [--agent <name>]` | Hands over task execution to the daemon. Runs in a git worktree via `-w` or `--worktree`. If `--dir` or `--branch` are omitted when running in a worktree, they are automatically generated using the workflow name and a random suffix to prevent collisions. Specifying `--agent` selects the agent adapter (e.g. `gemini` or `aider`). |
| `list` | Lists all active and completed workflows. |
| `status <name>` | Shows detailed status, phase, and QA cycles of a workflow. |
| `logs <name> [-f\|--follow] [--tail <lines>]` | Streams or outputs workflow execution logs. Use `-f` or `--follow` to stream logs. |
| `kill <name>` | Terminates a running workflow. |
| `remove <name>` | Cleans up a finished or failed workflow from the daemon. |

### Daemon CLI Options (`afk-coder-daemon`)
When running the daemon binary directly (e.g., for development or debugging):
*   `--socket <path>`: Override the default socket path.
*   `--help`: Display help and options.

---

## 🛡️ Security

- **Isolation:** All LLM-generated commands are executed inside a Docker container.
- **Privilege:** The daemon runs as your normal logged-in user, while the *internal* sandbox has root access for setup.
- **Auth:** Google OAuth 2.0 with PKCE ensures secure access to your AI subscription.

---

## 🚦 QA Phase & Cycle Rules

When the Coding Phase completes (all tasks in `tasks.md` are marked `[x]`), the workflow enters the **QA Phase**.

1.  **QA Cycle Definition:** A single QA Cycle consists of the transition `Coding Phase -> QA Phase -> Coding Phase` (if unmet requirements are found).
2.  **Max Cycles Limit:** A workflow is capped at a maximum of **3 QA cycles**. If requirements remain unmet after 3 cycles, the workflow will terminate with the status `Failed: Max QA Cycles Exceeded`.
3.  **QA Task Format Requirement:** Any new tasks added to `tasks.md` during the QA Phase must contain a PRD reference suffix matching `[PRD: <requirement>]` (e.g., `- [ ] Fix server response [PRD: Section 2.1]`). Tasks failing to match this format will cause a validation failure.

---

## 👨‍💻 Development

### Build from Source
```bash
npm install
npm run build
```

### Running Tests
```bash
npm test
```

## 📄 License
This project is licensed under the [ISC License](LICENSE).
