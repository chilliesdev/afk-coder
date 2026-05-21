import Docker from 'dockerode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { ExecutionRuntime, RuntimeHandle, RuntimeResult } from './execution-runtime';
import { ConfigManager, TOKENS_PATH } from '../common/config';

export class DockerRuntime implements ExecutionRuntime {
  private docker: Docker;
  private readonly configManager: ConfigManager;

  constructor(configManager: ConfigManager = new ConfigManager()) {
    this.docker = new Docker();
    this.configManager = configManager;
  }

  /**
   * Runs an arbitrary prompt inside a Docker container using the Gemini CLI.
   * @param prompt The full command or prompt to execute.
   * @param dir The directory to map to /app inside the container.
   * @param configDir Optional directory for configuration files.
   * @returns A handle to the running process.
   */
  async run(prompt: string, dir: string, configDir?: string): Promise<RuntimeHandle> {
    const configManager = configDir ? new ConfigManager(configDir) : this.configManager;
    await configManager.refreshToken();
    const tokens = configManager.loadTokens();
    const config = configManager.loadConfig();
    const hasApiKey = !!process.env['GEMINI_API_KEY'];
    const hasTokens = !!(tokens && tokens.access_token);

    if (!hasApiKey && !hasTokens) {
      throw new Error('Authentication required. Please run "afk-coder login" or set the GEMINI_API_KEY environment variable.');
    }
    
    const env: string[] = [];
    const binds: string[] = [`${path.resolve(dir)}:/app`];
    let tempDir: string | undefined;

    if (tokens && tokens.access_token) {
      // Create a temporary directory for the settings file
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-coder-gemini-'));
      const geminiSettingsDir = path.join(tempDir, '.gemini');
      fs.mkdirSync(geminiSettingsDir, { recursive: true });
      
      const settings = {
        security: {
          auth: {
            selectedType: 'oauth-personal'
          }
        }
      };
      
      fs.writeFileSync(path.join(geminiSettingsDir, 'settings.json'), JSON.stringify(settings));
      
      const tokensPath = configDir ? path.join(configDir, 'tokens.json') : TOKENS_PATH;
      if (fs.existsSync(tokensPath)) {
        fs.copyFileSync(tokensPath, path.join(geminiSettingsDir, 'oauth_creds.json'));
      }
      
      // Mount the settings directory into the container's root home
      binds.push(`${geminiSettingsDir}:/root/.gemini`);
    } else if (process.env.GEMINI_API_KEY) {
      env.push(`GEMINI_API_KEY=${process.env.GEMINI_API_KEY}`);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || config.auth?.clientId;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || config.auth?.clientSecret;

    if (clientId) env.push(`GOOGLE_CLIENT_ID=${clientId}`);
    if (clientSecret) env.push(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    
    // Bypass Gemini CLI trust requirement in sandbox
    env.push('GEMINI_CLI_TRUST_WORKSPACE=true');
    
    // Also pass through common Gemini CLI auth vars if present on host
    if (process.env.GEMINI_CLI_AUTH_METHOD) env.push(`GEMINI_CLI_AUTH_METHOD=${process.env.GEMINI_CLI_AUTH_METHOD}`);
    if (process.env.GEMINI_PROJECT_ID) env.push(`GEMINI_PROJECT_ID=${process.env.GEMINI_PROJECT_ID}`);

    const image = config.sandbox.image;
    await this.ensureImage(image);

    const container = await this.docker.createContainer({
      Image: image,
      Cmd: ['bash', '-c', prompt],
      Env: env,
      HostConfig: {
        Binds: binds,
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

    const cleanup = async () => {
      if (tempDir) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    };

    return {
      pid,
      prompt,
      stop: async () => {
        try {
          await container.kill();
        } catch {
          // Container might already be stopped
        }
        try {
          await container.remove();
        } catch {
          // Container might already be removed
        }
        await cleanup();
      },
      wait: async (): Promise<RuntimeResult> => {
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
        } catch {
          // Container might already be removed by stop()
        }
        await cleanup();
        return {
          exitCode: result.StatusCode,
          logs: logs,
        };
      }
    };
  }

  /**
   * Ensures the Docker image is available locally, pulling it if necessary.
   */
  private async ensureImage(image: string) {
    try {
      await this.docker.getImage(image).inspect();
    } catch (error: any) {
      if (error.statusCode !== 404) {
        throw error;
      }

      console.log(`Image ${image} not found locally. Pulling...`);
      await new Promise((resolve, reject) => {
        this.docker.pull(image, (err: any, stream: any) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (err: any, res: any) => {
            if (err) return reject(err);
            resolve(res);
          }, (event: any) => {
            // Minimal logging to avoid spamming the console
            if (event.status && !['Downloading', 'Extracting'].includes(event.status)) {
              console.log(`Pulling ${image}: ${event.status}`);
            }
          });
        });
      });
    }
  }
}
