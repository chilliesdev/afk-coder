import Docker from 'dockerode';
import * as path from 'path';
import { loadTokens, refreshToken, loadConfig } from '../common/config';

export interface SandboxOptions {
  dir: string;
  image: string;
}

export class Sandbox {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  /**
   * Runs an arbitrary prompt inside a Docker container using the Gemini CLI.
   * @param prompt The full command or prompt to execute.
   * @param dir The directory to map to /app inside the container.
   * @returns A handle to the running process, including its PID and methods to stop or wait for completion.
   */
  async run(prompt: string, dir: string) {
    await refreshToken();
    const tokens = loadTokens();
    const config = loadConfig();
    const env = [
      `GEMINI_API_KEY=${process.env['GEMINI_API_KEY'] || ''}`,
    ];

    if (tokens) {
      if (tokens.access_token) env.push(`GOOGLE_ACCESS_TOKEN=${tokens.access_token}`);
      if (tokens.refresh_token) env.push(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    }

    const container = await this.docker.createContainer({
      Image: config.sandbox.image,
      Cmd: ['bash', '-c', prompt],
      Env: env,
      HostConfig: {
        Binds: [`${path.resolve(dir)}:/app`],
        Memory: config.sandbox.memory,
        NanoCpus: config.sandbox.nanoCpus,
        NetworkMode: 'host',
      },
      WorkingDir: '/app',
      User: 'root',
    });

    await container.start();
    
    // Get the real PID of the process in the container
    const inspect = await container.inspect();
    const pid = inspect.State.Pid;

    return {
      pid,
      prompt,
      stop: async () => {
        try {
          await container.kill();
        } catch (e) {
          // Container might already be stopped
        }
        try {
          await container.remove();
        } catch (e) {
          // Container might already be removed
        }
      },
      wait: async () => {
        const result = await container.wait();
        // Get logs and demux them (strip the 8-byte Docker headers)
        const logBuffer = await container.logs({ stdout: true, stderr: true });
        let logs = '';
        let offset = 0;
        while (offset < logBuffer.length) {
          const size = logBuffer.readUInt32BE(offset + 4);
          logs += logBuffer.toString('utf8', offset + 8, offset + 8 + size);
          offset += 8 + size;
        }
        try {
          await container.remove();
        } catch (e) {
          // Container might already be removed by stop()
        }
        return {
          exitCode: result.StatusCode,
          logs: logs,
        };
      }
    };
  }

  /**
   * Runs a specific coding task inside the sandbox.
   * @param workflowName The name of the workflow this task belongs to.
   * @param taskDescription The description of the task to perform.
   * @param dir The directory containing the project files (must include tasks.md).
   * @returns A handle to the running task.
   */
  async runTask(workflowName: string, taskDescription: string, dir: string) {
    const prompt = `gemini --yolo --prompt "Focus only on the following task: \\"${taskDescription}\\". Pick it from tasks.md, mark it as done by changing [ ] to [x], and end the session. Do not modify the task description text itself."`;
    return this.run(prompt, dir);
  }
}
