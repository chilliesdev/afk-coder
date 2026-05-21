import { Workflow, Task, TaskBoard as ITaskBoard } from '../common/types';
import * as fs from 'fs';
import * as path from 'path';
import * as winston from 'winston';
import { TaskBoard } from './task-board';
import { AgentOutcomeEvaluator } from './agent-outcome';
import { ExecutionRuntime } from './execution-runtime';
import { AgentStrategy } from './agent-strategy';

interface WorkflowRuntime extends Workflow {
  stopHandle?: () => Promise<void>;
}

export class WorkflowManager {
  private workflows: Map<string, WorkflowRuntime> = new Map();
  private loggers: Map<string, winston.Logger> = new Map();
  private runtime: ExecutionRuntime;
  private strategy: AgentStrategy;
  private taskBoardFactory: (path: string) => ITaskBoard;
  private evaluator: AgentOutcomeEvaluator;

  constructor(
    runtime: ExecutionRuntime, 
    strategy: AgentStrategy, 
    taskBoardFactory: (path: string) => ITaskBoard = (p) => new TaskBoard(p),
    evaluator: AgentOutcomeEvaluator = new AgentOutcomeEvaluator()
  ) {
    this.runtime = runtime;
    this.strategy = strategy;
    this.taskBoardFactory = taskBoardFactory;
    this.evaluator = evaluator;
  }

  private getOrCreateLogger(name: string, dir: string): winston.Logger {
    if (this.loggers.has(name)) {
      return this.loggers.get(name)!;
    }

    const logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { workflow: name },
      transports: [
        new winston.transports.File({ filename: path.join(dir, 'workflow.json.log') }),
      ],
    });

    this.loggers.set(name, logger);
    return logger;
  }

  async startWorkflow(name: string, dir: string, configDir?: string) {
    const existing = this.workflows.get(name);
    if (existing && existing.status !== 'Done' && !existing.status.startsWith('Failed')) {
      throw new Error(`Workflow ${name} is already running`);
    }

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tasksPath = path.join(dir, 'tasks.md');
    const prdPath = path.join(dir, 'PRD.md');

    if (!fs.existsSync(prdPath)) {
      throw new Error(`PRD.md not found in ${dir}`);
    }
    if (!fs.existsSync(tasksPath)) {
      throw new Error(`tasks.md not found in ${dir}`);
    }

    const taskBoard = this.taskBoardFactory(tasksPath);
    const boardState = await taskBoard.load();
    
    const progress = boardState.progress;
    const pendingTasks = boardState.pendingTasks;

    if (pendingTasks.length === 0) {
      throw new Error(`No pending tasks found in tasks.md in ${dir}`);
    }

    const workflow: WorkflowRuntime = {
      name,
      dir,
      uptime: Date.now(),
      progress: `${progress.completed}/${progress.total}`,
      status: 'Running',
      tokenUsage: { input: 0, output: 0, total: 0 },
      recentTasks: [],
      configDir,
    };
    this.workflows.set(name, workflow);

    const logger = this.getOrCreateLogger(name, dir);
    logger.info('Workflow started', { dir });

    this.runWorkflowLoop(workflow).catch(err => {
      logger.error('Workflow failed', { error: err.message, stack: err.stack });
      workflow.status = 'Failed';
    });

    return workflow;
  }

  private async runWorkflowLoop(workflow: WorkflowRuntime) {
    const tasksPath = path.join(workflow.dir, 'tasks.md');
    const taskBoard = this.taskBoardFactory(tasksPath);
    const logger = this.getOrCreateLogger(workflow.name, workflow.dir);

    while (workflow.status !== 'Failed' && workflow.status !== 'Done') {
      const boardState = await taskBoard.load();
      const pendingTasks = boardState.pendingTasks;
      const progress = boardState.progress;

      workflow.progress = `${progress.completed}/${progress.total}`;

      if (pendingTasks.length === 0) {
        logger.info('All tasks completed');
        workflow.status = 'Done';
        break;
      }

      workflow.status = `Running: Autonomous Agent Loop`;
      workflow.currentTask = 'Autonomous Task Selection';

      let retries = 0;
      let success = false;

      while (!success && workflow.status.startsWith('Running')) {
        try {
          const prompt = this.strategy.getAutonomousLoopPrompt();
          const run = await this.runtime.run(prompt, workflow.dir, workflow.configDir);
          
          workflow.pid = run.pid;
          workflow.stopHandle = run.stop;
          
          logger.info('Running agent loop', { 
            prompt: run.prompt 
          });

          const result = await run.wait();
          workflow.pid = undefined;
          workflow.stopHandle = undefined;

          if (workflow.status === 'Done' || !workflow.status.startsWith('Running')) {
            // Workflow was killed or completed while waiting
            break;
          }

          let hasNewCompletedTasks = false;
          let newlyCompletedTasks: Task[] = [];
          let updatedState = boardState;

          if (result.exitCode === 0) {
            const reconciliation = await taskBoard.reconcile();
            newlyCompletedTasks = reconciliation.newlyCompleted;
            updatedState = reconciliation.state;
            hasNewCompletedTasks = newlyCompletedTasks.length > 0;
          }

          // Call deep evaluator
          const decision = this.evaluator.evaluate(
            result.logs,
            result.exitCode,
            retries,
            hasNewCompletedTasks
          );

          // Update global token usage
          workflow.tokenUsage.input += decision.tokens.input;
          workflow.tokenUsage.output += decision.tokens.output;
          workflow.tokenUsage.total += decision.tokens.total;

          if (decision.action === 'next') {
            // Update task tracking
            newlyCompletedTasks.forEach(t => {
              workflow.recentTasks.unshift(t.description);
            });
            if (workflow.recentTasks.length > 5) {
              workflow.recentTasks.length = 5;
            }
            workflow.currentTask = undefined;
            workflow.progress = `${updatedState.progress.completed}/${updatedState.progress.total}`;

            logger.info('Tasks completed successfully', { 
              completedTasks: newlyCompletedTasks.map(t => t.description), 
              exitCode: result.exitCode,
              output: result.logs,
              tokenUsage: decision.tokens,
              workflowTokenUsage: workflow.tokenUsage
            });

            success = true;
            await new Promise(resolve => setTimeout(resolve, decision.delayMs));
          } else if (decision.action === 'retry') {
            retries++;
            const error = decision.error!;
            if (error.type === 'Quota') {
              logger.warn('Gemini API quota exceeded, waiting longer...', {
                attempt: retries,
                nextRetryIn: `${decision.delayMs / 1000}s`
              });
            } else {
              logger.warn('Agent loop failed, retrying...', { 
                exitCode: result.exitCode, 
                attempt: retries,
                nextRetryIn: `${decision.delayMs / 1000}s`,
                output: result.logs
              });
            }
            await new Promise(resolve => setTimeout(resolve, decision.delayMs));
          } else {
            // action === 'fail'
            const error = decision.error!;
            if (error.type === 'Safety') {
              logger.error('Task blocked by safety filters', {
                output: result.logs
              });
              workflow.status = 'Failed: Safety Block';
            } else if (error.type === 'NoProgress') {
              logger.error('Agent reported no progress', {
                output: result.logs
              });
              workflow.status = 'Failed: No Progress';
            } else {
              logger.error('Agent loop failed after max retries', { 
                exitCode: result.exitCode,
                output: result.logs,
                error: error.message
              });
              workflow.status = 'Failed';
            }
            break;
          }
        } catch (err: any) {
          // JS/Runtime level errors (not agent errors)
          const decision = this.evaluator.evaluate(
            err.message,
            -1, // indicate non-zero exit code
            retries,
            false
          );

          if (decision.action === 'retry') {
            retries++;
            logger.error('Runtime error, retrying...', { 
              error: err.message,
              attempt: retries,
              nextRetryIn: `${decision.delayMs / 1000}s`
            });
            await new Promise(resolve => setTimeout(resolve, decision.delayMs));
          } else {
            logger.error('Runtime error after max retries', { 
              error: err.message 
            });
            workflow.status = 'Failed';
            break;
          }
        }
      }

      if (workflow.status === 'Failed' || workflow.status.startsWith('Failed')) break;
    }
  }

  listWorkflows(): Workflow[] {
    return Array.from(this.workflows.values()).map(w => ({
      ...w,
      uptime: Date.now() - w.uptime, // Return uptime in ms
    }));
  }

  getWorkflow(name: string): Workflow | undefined {
    const w = this.workflows.get(name);
    if (!w) return undefined;
    return {
      ...w,
      uptime: Date.now() - w.uptime,
    };
  }

  async killWorkflow(name: string) {
    const workflow = this.workflows.get(name);
    if (!workflow) {
      throw new Error(`Workflow ${name} not found`);
    }
    const logger = this.getOrCreateLogger(name, workflow.dir);
    logger.info('Workflow killed by user');
    workflow.status = 'Killed'; // This will stop the loop
    if (workflow.stopHandle) {
      await workflow.stopHandle();
      workflow.stopHandle = undefined;
    }
  }

  removeWorkflow(name: string) {
    const workflow = this.workflows.get(name);
    if (!workflow) {
      throw new Error(`Workflow ${name} not found`);
    }

    if (workflow.status !== 'Done' && !workflow.status.startsWith('Failed') && workflow.status !== 'Killed') {
      throw new Error(`Workflow ${name} is still running. Kill it first.`);
    }

    this.workflows.delete(name);
    this.loggers.delete(name);
  }

  getLogs(name: string, options: { tail?: number, offset?: number } = {}) {
    const workflow = this.workflows.get(name);
    if (!workflow) {
      throw new Error(`Workflow ${name} not found`);
    }
    const logFile = path.join(workflow.dir, 'workflow.json.log');
    if (fs.existsSync(logFile)) {
      if (options.offset !== undefined) {
        const stats = fs.statSync(logFile);
        if (options.offset >= stats.size) {
          return { content: '', nextOffset: stats.size };
        }
        const fd = fs.openSync(logFile, 'r');
        const buffer = Buffer.alloc(stats.size - options.offset);
        fs.readSync(fd, buffer, 0, buffer.length, options.offset);
        fs.closeSync(fd);
        return { content: buffer.toString('utf-8'), nextOffset: stats.size };
      }

      const content = fs.readFileSync(logFile, 'utf-8');
      const stats = fs.statSync(logFile);
      if (options.tail) {
        const lines = content.trim().split('\n');
        return { content: lines.slice(-options.tail).join('\n') + '\n', nextOffset: stats.size };
      }
      return { content: content, nextOffset: stats.size };
    }
    return { content: 'No logs found.', nextOffset: 0 };
  }
}


