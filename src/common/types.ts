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
  phase?: 'Coding' | 'QA';
  qaCycles?: number;
}

export const MILESTONE_TYPE = 'milestone';

export const MILESTONE_STATUS = {
  STARTING: 'starting',
  COMPLETED: 'completed',
  FAILED: 'failed',
  INFO: 'info',
} as const;

export type MilestoneStatus = typeof MILESTONE_STATUS[keyof typeof MILESTONE_STATUS];

export interface MilestoneEvent {
  type: typeof MILESTONE_TYPE;
  status: MilestoneStatus;
  message: string;
  timestamp: string;
}

export interface DaemonResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface StartWorkflowRequestArgs {
  name: string;
  dir: string;
  configDir?: string;
  isWorktree?: boolean;
  sourceRepo?: string;
  branch?: string;
  agent?: string;
}
