import { Workflow, Task, TokenUsage, TaskBoard as ITaskBoard } from '../common/types';
import * as winston from 'winston';
import { Agent } from './agent';
import { OutcomeAnalyzer } from './agent-outcome';

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
  public pid?: number;

  private stopHandle?: () => Promise<void>;
  private agent: Agent;
  private taskBoard: ITaskBoard;
  private logger: winston.Logger;
  private analyzer: OutcomeAnalyzer;
  private activeDelayTimeout?: NodeJS.Timeout;

  constructor(
    name: string,
    dir: string,
    agent: Agent,
    taskBoard: ITaskBoard,
    logger: winston.Logger,
    configDir?: string,
    analyzer: OutcomeAnalyzer = new OutcomeAnalyzer()
  ) {
    this.name = name;
    this.dir = dir;
    this.agent = agent;
    this.taskBoard = taskBoard;
    this.logger = logger;
    this.configDir = configDir;
    this.analyzer = analyzer;
    this.uptimeStart = Date.now();
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
    while (this.status !== 'Failed' && this.status !== 'Done' && this.status !== 'Killed' && !this.status.startsWith('Failed')) {
      const boardState = await this.taskBoard.load();
      const pendingTasks = boardState.pendingTasks;
      const progress = boardState.progress;

      this.progress = `${progress.completed}/${progress.total}`;

      if (pendingTasks.length === 0) {
        this.logger.info('All tasks completed');
        this.status = 'Done';
        break;
      }

      this.status = `Running: Autonomous Agent Loop`;
      this.currentTask = 'Autonomous Task Selection';

      let retries = 0;
      let success = false;

      while (!success && (this.status === 'Running' || this.status.startsWith('Running'))) {
        try {
          const run = await this.agent.runAutonomousLoop(this.dir, this.configDir);
          
          this.pid = run.pid;
          this.stopHandle = run.stop;
          
          this.logger.info('Running agent loop', { 
            prompt: run.prompt 
          });

          const result = await run.wait();
          this.pid = undefined;
          this.stopHandle = undefined;

          if (this.status === 'Done' || this.status === 'Killed' || !this.status.startsWith('Running')) {
            break;
          }

          let newlyCompleted: Task[] = [];
          if (result.exitCode === 0) {
            const reconciliation = await this.taskBoard.reconcile();
            newlyCompleted = reconciliation.newlyCompleted;
          }

          const decision = this.analyzer.analyze(
            result.logs,
            result.exitCode,
            retries,
            newlyCompleted.length
          );

          this.tokenUsage.input += decision.tokens.input;
          this.tokenUsage.output += decision.tokens.output;
          this.tokenUsage.total += decision.tokens.total;

          if (decision.action === 'next') {
            for (const t of newlyCompleted) {
              this.recentTasks.unshift(t.description);
            }
            if (this.recentTasks.length > 5) {
              this.recentTasks.length = 5;
            }
            const updatedState = await this.taskBoard.load();
            this.currentTask = undefined;
            this.progress = `${updatedState.progress.completed}/${updatedState.progress.total}`;

            this.logger.info('Tasks completed successfully', { 
              completedTasks: newlyCompleted.map(t => t.description), 
              exitCode: result.exitCode,
              output: result.logs,
              tokenUsage: decision.tokens,
              workflowTokenUsage: this.tokenUsage
            });

            success = true;
            await this.delay(decision.delayMs);
            continue;
          }

          if (decision.action === 'retry') {
            retries++;
            const error = decision.error!;
            if (error.type === 'Quota') {
              this.logger.warn('Gemini API quota exceeded, waiting longer...', {
                attempt: retries,
                nextRetryIn: `${decision.delayMs / 1000}s`
              });
              await this.delay(decision.delayMs);
              continue;
            }
            
            this.logger.warn('Agent loop failed, retrying...', { 
              exitCode: result.exitCode, 
              attempt: retries,
              nextRetryIn: `${decision.delayMs / 1000}s`,
              output: result.logs
            });
            await this.delay(decision.delayMs);
            continue;
          }

          const error = decision.error!;
          if (error.type === 'Safety') {
            this.logger.error('Task blocked by safety filters', {
              output: result.logs
            });
            this.status = 'Failed: Safety Block';
            break;
          }
          
          if (error.type === 'NoProgress') {
            this.logger.error('Agent reported no progress', {
              output: result.logs
            });
            this.status = 'Failed: No Progress';
            break;
          }
          
          this.logger.error('Agent loop failed after max retries', { 
            exitCode: result.exitCode,
            output: result.logs,
            error: error.message
          });
          this.status = 'Failed';
          break;
        } catch (error: any) {
          const decision = this.analyzer.analyze(
            error.message,
            -1,
            retries,
            0
          );

          if (decision.action === 'retry') {
            retries++;
            this.logger.error('Runtime error, retrying...', { 
              error: error.message,
              attempt: retries,
              nextRetryIn: `${decision.delayMs / 1000}s`
            });
            await this.delay(decision.delayMs);
            continue;
          }

          this.logger.error('Runtime error after max retries', { 
            error: error.message 
          });
          this.status = 'Failed';
          break;
        }
      }

      if (this.status === 'Failed' || this.status.startsWith('Failed') || this.status === 'Killed') break;
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.activeDelayTimeout = setTimeout(() => {
        this.activeDelayTimeout = undefined;
        resolve();
      }, ms);
    });
  }

  async kill() {
    this.logger.info('Workflow executor killed by user');
    this.status = 'Killed';
    
    if (this.activeDelayTimeout) {
      clearTimeout(this.activeDelayTimeout);
      this.activeDelayTimeout = undefined;
    }

    if (this.stopHandle) {
      await this.stopHandle();
      this.stopHandle = undefined;
    }
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
    };
  }
}
