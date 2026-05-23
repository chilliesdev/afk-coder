import Docker from 'dockerode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { ExecutionRuntime, RuntimeHandle, RuntimeResult } from './execution-runtime';
import { ConfigManager, TOKENS_PATH } from '../common/config';

export class DockerRuntime implements ExecutionRuntime {
  private docker: Docker;
  private readonly configManager: ConfigManager;
  private container?: Docker.Container;
  private containerPid?: number;
  private tempDir?: string;

  constructor(configManager: ConfigManager = new ConfigManager()) {
    this.docker = new Docker();
    this.configManager = configManager;
  }

  /**
   * Starts a persistent Docker container for the workflow.
   */
  async start(dir: string, configDir?: string): Promise<void> {
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
      this.tempDir = tempDir;
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
      Cmd: ['tail', '-f', '/dev/null'],
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

    this.container = container;
    this.containerPid = pid;
  }

  /**
   * Stops the persistent container and cleans up temporary credentials.
   */
  async stop(): Promise<void> {
    const container = this.container;
    const tempDir = this.tempDir;

    this.container = undefined;
    this.containerPid = undefined;
    this.tempDir = undefined;

    if (container) {
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
    }

    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Runs an arbitrary prompt inside a Docker container using the Gemini CLI.
   * If start() has been called, executes the command in the persistent container.
   * Otherwise, creates a temporary container for backwards compatibility.
   */
  async run(prompt: string, _dir: string, _configDir?: string): Promise<RuntimeHandle> {
    if (this.container) {
      const container = this.container;
      const exec = await container.exec({
        Cmd: ['bash', '-c', prompt],
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start({ Detach: false });

      const readStream = (): Promise<Buffer> => {
        return new Promise((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', (err) => reject(err));
        });
      };

      let waitPromise: Promise<RuntimeResult> | undefined;
      const getWait = () => {
        if (!waitPromise) {
          waitPromise = (async () => {
            const logBuffer = await readStream();
            const inspect = await exec.inspect();
            const exitCode = inspect.ExitCode ?? 0;

            let logs = '';
            let offset = 0;
            while (offset < logBuffer.length) {
              if (offset + 8 > logBuffer.length) break;
              const size = logBuffer.readUInt32BE(offset + 4);
              if (offset + 8 + size > logBuffer.length) break;
              logs += logBuffer.toString('utf8', offset + 8, offset + 8 + size);
              offset += 8 + size;
            }

            return {
              exitCode,
              logs
            };
          })();
        }
        return waitPromise;
      };

      return {
        pid: this.containerPid,
        prompt,
        stop: async () => {
          await this.stop();
        },
        wait: getWait
      };
    }
    throw new Error('Container not started. Call start() before run().');
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
