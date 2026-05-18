export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export type AgentErrorType = 'Quota' | 'Safety' | 'Runtime' | 'NoProgress';

export interface AgentError {
  type: AgentErrorType;
  message: string;
}

export interface Outcome {
  success: boolean;
  tokens: TokenUsage;
  error?: AgentError;
}

export interface Task {
  completed: boolean;
  description: string;
}

export interface TaskBoard {
  sync(): Promise<void>;
  getPendingTasks(): Task[];
  getNewlyCompleted(previousSnapshot: Task[]): Task[];
  getProgress(): { completed: number; total: number; percentage: string };
  getTasks(): Task[];
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
