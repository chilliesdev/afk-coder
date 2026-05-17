export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface Workflow {
  name: string;
  pid?: number;
  uptime: number;
  progress: string; // e.g., "4/10"
  dir: string;
  status: string;
  tokenUsage: TokenUsage;
  currentTask?: string;
  recentTasks: string[];
  configDir?: string;
}

export interface DaemonResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}
