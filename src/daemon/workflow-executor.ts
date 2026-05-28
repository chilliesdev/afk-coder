import { Workflow, Task, TokenUsage, TaskBoard as ITaskBoard } from '../common/types';
import * as winston from 'winston';
import { Agent } from './agent';
import { CodingPhaseAdapter, QaPhaseAdapter, WorkflowPhase, WorkflowPhaseContext } from './workflow-phase';
import { GitClient, ShellGitClient } from '../common/git';
import { ConfigManager } from '../common/config';
import { WorkflowGitManager } from './workflow-git';

export class WorkflowExecutor {
  public readonly name: string;
  public readonly dir: string;
  public readonly configDir?: string;
  public status: string = 'Running';
  public uptimeStart: number;
  public progress: string = '0/0';
  public tokenUsage: TokenUsage = { input: 0, output: 0, total: 0 };
  public recentTasks: string[] = [];
  public currentTask?: string;
  public pid?: number; // Not accurately tracked anymore since agent is deep, but keep for type
  public isWorktree?: boolean;
  public sourceRepo?: string;
  public branch?: string;
  public phase: 'Coding' | 'QA' = 'Coding';
  public qaCycles: number = 0;

  public readonly agent: Agent;
  private taskBoard: ITaskBoard;
  private logger: winston.Logger;
  
  private phases: Map<string, WorkflowPhase> = new Map();
  public readonly git: GitClient;
  public readonly gitManager: WorkflowGitManager;

  private onFinishedCallbacks: (() => void)[] = [];

  public onFinished(cb: () => void): () => void {
    this.onFinishedCallbacks.push(cb);
    return () => {
      this.onFinishedCallbacks = this.onFinishedCallbacks.filter(c => c !== cb);
    };
  }

  private notifyFinished() {
    for (const cb of this.onFinishedCallbacks) {
      try {
        cb();
      } catch {
        // ignore
      }
    }
  }

  constructor(
    name: string,
    dir: string,
    agent: Agent,
    taskBoard: ITaskBoard,
    logger: winston.Logger,
    configDir?: string,
    isWorktree?: boolean,
    sourceRepo?: string,
    branch?: string,
    gitClient?: GitClient,
    codingPhase?: WorkflowPhase,
    qaPhase?: WorkflowPhase,
    configManager?: ConfigManager
  ) {
    this.name = name;
    this.dir = dir;
    this.agent = agent;
    this.taskBoard = taskBoard;
    this.logger = logger;
    this.configDir = configDir;
    this.isWorktree = isWorktree;
    this.sourceRepo = sourceRepo;
    this.branch = branch;
    this.uptimeStart = Date.now();
    
    this.phases.set('Coding', codingPhase || new CodingPhaseAdapter());
    this.phases.set('QA', qaPhase || new QaPhaseAdapter());
    this.git = gitClient || new ShellGitClient(dir);
    this.gitManager = new WorkflowGitManager(this.git, this.logger, this.configDir, configManager);
  }

  get uptime(): number {
    return Date.now() - this.uptimeStart;
  }

  async start() {
    this.logger.info('Workflow executor started', { dir: this.dir });
    this.runLoop().catch(error => {
      this.logger.error('Workflow executor failed', { error: error.message, stack: error.stack });
      this.status = 'Failed';
    });
  }

  private async runLoop() {
    try {
      try {
        await this.agent.start(this.dir, this.configDir);
      } catch (error: any) {
        this.logger.error('Failed to start execution runtime container', { error: error.message });
        this.status = 'Failed: Runtime Startup Error';
        return;
      }

      try {
        while (this.status !== 'Failed' && this.status !== 'Done' && this.status !== 'Killed' && !this.status.startsWith('Failed')) {
          const boardState = await this.taskBoard.load();
          this.progress = `${boardState.progress.completed}/${boardState.progress.total}`;

          this.status = this.phase === 'Coding' ? 'Running: Autonomous Agent Loop' : 'Running: QA Phase';
          this.currentTask = this.phase === 'Coding' ? (boardState.pendingTasks[0]?.description ?? undefined) : undefined;
          
          const context: WorkflowPhaseContext = {
            dir: this.dir,
            configDir: this.configDir,
            taskBoard: this.taskBoard,
            agent: this.agent,
            logger: this.logger,
            qaCycles: this.qaCycles,
            reportTokens: (input: number, output: number) => {
              this.tokenUsage.input += input;
              this.tokenUsage.output += output;
              this.tokenUsage.total += (input + output);
            },
            reportCompletedTasks: async (tasks: Task[]) => {
              for (const t of tasks) {
                this.recentTasks.unshift(t.description);
                if (this.isWorktree && this.sourceRepo && this.branch && this.gitManager.isAutoCommitEnabled()) {
                  await this.gitManager.autoCommitTask(t.description);
                }
              }
              if (this.recentTasks.length > 5) {
                this.recentTasks.length = 5;
              }
              const updatedState = await this.taskBoard.load();
              this.progress = `${updatedState.progress.completed}/${updatedState.progress.total}`;
              this.currentTask = undefined;
            }
          };

          try {
            const phaseExecutor = this.phases.get(this.phase);
            if (!phaseExecutor) {
              throw new Error(`Unknown workflow phase: ${this.phase}`);
            }
            const nextPhase = await phaseExecutor.execute(context);

            if (this.status === 'Killed') break;

            if (nextPhase === 'Done') {
              this.status = 'Done';
              if (this.isWorktree && this.sourceRepo && this.branch && this.gitManager.isAutoCommitEnabled()) {
                await this.gitManager.autoCommitCompletion();
              }
              break;
            } else if (nextPhase.startsWith('Failed')) {
              this.status = nextPhase;
              if (this.isWorktree && this.sourceRepo && this.branch && this.gitManager.isAutoCommitEnabled()) {
                await this.gitManager.autoCommitFailure(nextPhase);
              }
              break;
            } else if (nextPhase === 'QA' && this.phase !== 'QA') {
              this.phase = 'QA';
            } else if (nextPhase === 'Coding' && this.phase !== 'Coding') {
              this.phase = 'Coding';
              this.qaCycles++;
            }

          } catch (error: any) {
            if (this.status !== 'Killed') {
              this.logger.error('Workflow loop failed with exception', { error: error.message });
              this.status = 'Failed';
              if (this.isWorktree && this.sourceRepo && this.branch && this.gitManager.isAutoCommitEnabled()) {
                await this.gitManager.autoCommitFailureWithException();
              }
            }
            break;
          }
        }
      } finally {
        try {
          await this.agent.stop();
        } catch (error: any) {
          this.logger.warn('Failed to stop execution runtime container', { error: error.message });
        }
      }
    } finally {
      this.notifyFinished();
    }
  }

  async kill() {
    this.logger.info('Workflow executor killed by user');
    this.status = 'Killed';
    await this.agent.kill();
  }

  toWorkflow(): Workflow {
    return {
      name: this.name,
      dir: this.dir,
      uptime: this.uptime,
      progress: this.progress,
      status: this.status,
      tokenUsage: { ...this.tokenUsage },
      recentTasks: [...this.recentTasks],
      currentTask: this.currentTask,
      pid: this.pid,
      configDir: this.configDir,
      isWorktree: this.isWorktree,
      sourceRepo: this.sourceRepo,
      branch: this.branch,
      phase: this.phase,
      qaCycles: this.qaCycles,
    };
  }
}
