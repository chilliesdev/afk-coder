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

export type WorkflowAction = 'next' | 'retry' | 'fail';

export interface ExecutionDecision {
  action: WorkflowAction;
  delayMs: number;
  tokens: TokenUsage;
  newlyCompleted?: Task[];
  error?: AgentError;
}

export interface Task {
  completed: boolean;
  description: string;
}

export interface TaskBoardState {
  progress: { completed: number; total: number; percentage: string };
  pendingTasks: Task[];
  tasks: Task[];
}

export interface TaskBoard {
  load(): Promise<TaskBoardState>;
  reconcile(): Promise<{
    newlyCompleted: Task[];
    state: TaskBoardState;
  }>;
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
  isWorktree?: boolean;
  sourceRepo?: string;
  branch?: string;
}

export interface DaemonResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}
