import { Workflow, Task, TokenUsage, TaskBoard as ITaskBoard } from '../common/types';
import * as winston from 'winston';
import { Agent } from './agent';
import { CodingPhaseAdapter, QaPhaseAdapter, WorkflowPhase, WorkflowPhaseContext } from './workflow-phase';
import { GitClient, ShellGitClient } from '../common/git';
import { ConfigManager } from '../common/config';


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
  
  private codingPhase: WorkflowPhase;
  private qaPhase: WorkflowPhase;
  public readonly git: GitClient;

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
    gitClient?: GitClient
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
    
    this.codingPhase = new CodingPhaseAdapter();
    this.qaPhase = new QaPhaseAdapter();
    this.git = gitClient || new ShellGitClient(dir);
  }

  private isAutoCommitEnabled(): boolean {
    try {
      const configManager = new ConfigManager(this.configDir);
      const config = configManager.loadConfig();
      return config.git?.autoCommit === true;
    } catch {
      return false;
    }
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
        this.currentTask = this.phase === 'Coding' ? 'Autonomous Task Selection' : undefined;
        
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
              if (this.isWorktree && this.sourceRepo && this.branch && this.isAutoCommitEnabled()) {
                try {
                  this.git.add('.');
                  if (this.git.hasChanges()) {
                    this.git.commit(`feat: ${t.description}`);
                    this.logger.info(`Committed changes for task: ${t.description}`);
                  }
                } catch (error: any) {
                  this.logger.warn(`Failed to commit changes for task "${t.description}": ${error.message}`);
                }
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
          const nextPhase = await (this.phase === 'Coding' ? this.codingPhase.execute(context) : this.qaPhase.execute(context));

          if (this.status === 'Killed') break;

          if (nextPhase === 'Done') {
            this.status = 'Done';
            if (this.isWorktree && this.sourceRepo && this.branch && this.isAutoCommitEnabled()) {
              try {
                this.git.add('.');
                if (this.git.hasChanges()) {
                  this.git.commit('chore: workflow completed successfully');
                  this.logger.info('Committed final changes at workflow completion');
                }
              } catch (error: any) {
                this.logger.warn(`Failed to make final commit: ${error.message}`);
              }
            }
            break;
          } else if (nextPhase.startsWith('Failed')) {
            this.status = nextPhase;
            if (this.isWorktree && this.sourceRepo && this.branch && this.isAutoCommitEnabled()) {
              try {
                this.git.add('.');
                if (this.git.hasChanges()) {
                  this.git.commit(`chore: workflow failed - ${nextPhase}`);
                  this.logger.info(`Committed changes at workflow failure: ${nextPhase}`);
                }
              } catch (error: any) {
                this.logger.warn(`Failed to make failure commit: ${error.message}`);
              }
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
            if (this.isWorktree && this.sourceRepo && this.branch && this.isAutoCommitEnabled()) {
              try {
                this.git.add('.');
                if (this.git.hasChanges()) {
                  this.git.commit('chore: workflow failed with exception');
                }
              } catch {
                // Ignore git commit failure
              }
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
