import { ExecutionRuntime, RuntimeHandle, RuntimeResult } from '../../src/daemon/execution-runtime';

export class MockRuntime implements ExecutionRuntime {
  public nextResult: RuntimeResult = { exitCode: 0, logs: '' };
  public lastPrompt?: string;
  public lastDir?: string;
  public isRunning = false;
  public startCalled = false;
  public startedDir?: string;
  public stopCalled = false;
  public runDelay = 0;

  async start(dir: string, configDir?: string): Promise<void> {
    this.startCalled = true;
    this.startedDir = dir;
  }

  async stop(): Promise<void> {
    this.stopCalled = true;
  }

  async run(prompt: string, dir: string, configDir?: string): Promise<RuntimeHandle> {
    this.lastPrompt = prompt;
    this.lastDir = dir;
    this.isRunning = true;
    this.stopCalled = false;

    if (this.runDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.runDelay));
    }

    return {
      prompt,
      stop: async () => {
        this.isRunning = false;
        this.stopCalled = true;
      },
      wait: async (): Promise<RuntimeResult> => {
        if (this.runDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, this.runDelay));
        }
        this.isRunning = false;
        return this.nextResult;
      }
    };
  }
}
