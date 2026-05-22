# Gemini AFK Coding Daemon (`afk-coder`)

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Platform: Ubuntu](https://img.shields.io/badge/Platform-Ubuntu-orange.svg)](https://ubuntu.com/)

An autonomous, background-managed coding assistant for Ubuntu servers. `afk-coder` leverages the power of Gemini 2.5 Pro via the Gemini CLI to execute software development tasks continuously in a secure, isolated sandbox.

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

1.  **CLI Client (`afk-coder`):** The user interface for managing workflows, viewing logs, and initializing projects.
2.  **Service Daemon (`afk-coder-daemon`):** A `systemd`-managed background process that handles task queuing, Google OAuth 2.0 authentication, and sandbox management.
3.  **Execution Sandbox:** Ephemeral Docker containers where the Gemini CLI executes code modifications, installations, and tests with full internal root access.

---

## 📦 Installation

### Prerequisites
- **OS:** Ubuntu (or Debian-based distribution)
- **Node.js:** v18+ 
- **Docker:** Installed and running
- **Gemini CLI:** Installed globally (`npm install -g @google/gemini-cli`)

### Setup
Run the provided installation script:

```bash
chmod +x install.sh
./install.sh
```

This script will:
1. Build the project.
2. Create dedicated `afk-coder` (service) and `afk-coder-users` (access) groups.
3. Create a dedicated `afk-coder` system user.
4. Install binaries to `/usr/local/bin/`.
5. Register and enable the `afk-coder.service` systemd unit.

### User Access
By default, the daemon socket is owned by the `afk-coder-users` group. To allow a non-root user to use the `afk-coder` CLI, add them to this group:

```bash
sudo usermod -aG afk-coder-users $USER
# Log out and back in for changes to take effect
```

**Workspace Access:** The daemon runs as the `afk-coder` user. To allow it to read and write to projects inside your home directory, the installation script automatically adds the `afk-coder` user to your personal user group. If you install it manually or for a different user, you may need to run:
```bash
sudo usermod -aG $USER afk-coder
```

Finally, start the daemon:
```bash
sudo systemctl start afk-coder
```

---

## ⚙️ Configuration

You can configure `afk-coder` using environment variables or a configuration file.

### Environment Variables
For secure credentials management, you can provide your Google Cloud OAuth credentials via environment variables. Create a `.env` file by copying the example:
```bash
cp .env.example .env
```
Fill in your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the `.env` file. These values take precedence over the configuration file.

### Configuration File
You can customize the daemon and sandbox behavior by editing `~/.config/afk-coder/config.json`.

| Key | Default | Description |
| :--- | :--- | :--- |
| `daemon.socketGroup` | `"afk-coder-users"` | The Unix group that will own the control socket. |
| `daemon.socketPath` | `"/tmp/afk-coder.sock"` | The path to the daemon's control socket. |
| `sandbox.image` | (latest stable) | The Docker image used for the execution sandbox. |
| `sandbox.memory` | `2147483648` | Memory limit for the sandbox (bytes). |
| `sandbox.nanoCpus` | `2000000000` | CPU limit for the sandbox (nano CPUs). |
| `auth.redirectUri` | `"http://localhost:3000"` | The redirect URI for the OAuth 2.0 flow. |

---

## 🚦 Usage

### 1. Initialize a Project
Create a `PRD.md` in your project directory, then generate a `tasks.md`:

```bash
afk-coder init --dir /path/to/project [--force]
```
**Note:** The `init` command requires authentication. Please run `afk-coder login` first or set the `GEMINI_API_KEY` environment variable.

### 2. Authentication
Log in to your Google account to enable Gemini Pro access. Ensure your OAuth credentials are set via the `.env` file or configuration file before logging in:

```bash
afk-coder login
```

**Troubleshooting:** If you encounter an `EADDRINUSE` error (port 3000 is occupied), free the port by running `npx kill-port 3000` and try logging in again.

### 3. Start a Workflow
Kick off the autonomous coding loop. If `--dir` is not specified, it will run in the current directory.
```bash
afk-coder start my-feature --dir /path/to/project
```
To run the workflow in an isolated git worktree, use the `--worktree` flag:
```bash
afk-coder start my-feature --worktree --branch my-feature-branch
```

### 4. Monitor Progress
Check the status of running workflows or view live logs:

```bash
afk-coder list
afk-coder status my-feature
afk-coder logs my-feature -f
```

---

## ⌨️ CLI Reference

| Command | Description |
| :--- | :--- |
| `init [--dir <path>] [--prd <file>] [--force]` | Extracts tasks from a PRD file into `tasks.md` using a Docker sandbox. Use `--force` to overwrite existing `tasks.md`. |
| `login` | Performs Google OAuth 2.0 flow. |
| `start <name> [--dir <path>] [--worktree] [--branch <name>]` | Hands over task execution to the daemon. Supports running in a git worktree via `--worktree`. |
| `list` | Lists all active and completed workflows. |
| `status <name>` | Shows detailed status, phase, and QA cycles of a workflow. |
| `logs <name> [--tail \| -f]` | Streams or outputs workflow execution logs. |
| `kill <name>` | Terminates a running workflow. |
| `remove <name>` | Cleans up a finished or failed workflow from the daemon. |

---

## 🛡️ Security

- **Isolation:** All LLM-generated commands are executed inside a Docker container.
- **Privilege:** The daemon runs as a restricted `afk-coder` user, while the *internal* sandbox has root access for setup.
- **Auth:** Google OAuth 2.0 with PKCE ensures secure access to your AI subscription.

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
