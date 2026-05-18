export interface RuntimeResult {
  exitCode: number;
  logs: string;
}

export interface RuntimeHandle {
  pid?: number;
  prompt: string;
  stop: () => Promise<void>;
  wait: () => Promise<RuntimeResult>;
}

export interface ExecutionRuntime {
  run(prompt: string, dir: string, configDir?: string): Promise<RuntimeHandle>;
}
