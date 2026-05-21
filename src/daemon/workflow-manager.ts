import { Workflow, Task, TaskBoard as ITaskBoard } from '../common/types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as winston from 'winston';
import { TaskBoard } from './task-board';
import { FileSystemTaskStorage } from './task-storage';
import { TaskValidator } from '../common/validation';
import { OutcomeAnalyzer } from './agent-outcome';
import { Agent } from './agent';
import { WorkflowExecutor } from './workflow-executor';

export class WorkflowManager {
  private workflows: Map<string, WorkflowExecutor> = new Map();
  private loggers: Map<string, winston.Logger> = new Map();
  private agent: Agent;
  private taskBoardFactory: (path: string) => ITaskBoard;
  private evaluator: OutcomeAnalyzer;

  constructor(
    agent: Agent, 
    taskBoardFactory: (path: string) => ITaskBoard = (p) => new TaskBoard(new FileSystemTaskStorage(p), new TaskValidator()),
    evaluator: OutcomeAnalyzer = new OutcomeAnalyzer()
  ) {
    this.agent = agent;
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

  async startWorkflow(name: string, dir: string, options: { configDir?: string, isWorktree?: boolean, sourceRepo?: string, branch?: string } = {}): Promise<Workflow> {
    const existing = this.workflows.get(name);
    if (existing && existing.status !== 'Done' && !existing.status.startsWith('Failed') && existing.status !== 'Killed') {
      throw new Error(`Workflow ${name} is already running`);
    }

    if (!fs.existsSync(dir)) {
      if (options.isWorktree && options.sourceRepo && options.branch) {
        // Create the worktree branch. If it exists, checkout, else create it.
        try {
          execSync(`git show-branch ${options.branch}`, { stdio: 'ignore', cwd: options.sourceRepo });
          // Branch exists, create worktree from it
          execSync(`git worktree add "${dir}" ${options.branch}`, { cwd: options.sourceRepo });
        } catch {
          // Branch doesn't exist, create it via worktree add -b
          execSync(`git worktree add -b ${options.branch} "${dir}"`, { cwd: options.sourceRepo });
        }
      } else {
        fs.mkdirSync(dir, { recursive: true });
      }
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
    const pendingTasks = boardState.pendingTasks;

    if (pendingTasks.length === 0) {
      throw new Error(`No pending tasks found in tasks.md in ${dir}`);
    }

    const logger = this.getOrCreateLogger(name, dir);
    const executor = new WorkflowExecutor(
      name,
      dir,
      this.agent,
      taskBoard,
      logger,
      options.configDir,
      options.isWorktree,
      options.sourceRepo,
      options.branch,
      this.evaluator
    );

    this.workflows.set(name, executor);
    logger.info('Workflow started', { dir });
    
    // Start running the loop asynchronously
    executor.start();

    return executor.toWorkflow();
  }

  listWorkflows(): Workflow[] {
    return Array.from(this.workflows.values()).map(w => w.toWorkflow());
  }

  getWorkflow(name: string): Workflow | undefined {
    const w = this.workflows.get(name);
    if (!w) return undefined;
    return w.toWorkflow();
  }

  async killWorkflow(name: string) {
    const executor = this.workflows.get(name);
    if (!executor) {
      throw new Error(`Workflow ${name} not found`);
    }
    await executor.kill();
  }

  removeWorkflow(name: string) {
    const executor = this.workflows.get(name);
    if (!executor) {
      throw new Error(`Workflow ${name} not found`);
    }

    if (executor.status !== 'Done' && !executor.status.startsWith('Failed') && executor.status !== 'Killed') {
      throw new Error(`Workflow ${name} is still running. Kill it first.`);
    }

    if (executor.isWorktree && executor.sourceRepo) {
      try {
        execSync(`git worktree remove --force "${executor.dir}"`, { cwd: executor.sourceRepo });
      } catch (err: any) {
        console.error(`Failed to remove worktree: ${err.message}`);
      }
    }

    this.workflows.delete(name);
    this.loggers.delete(name);
  }

  getLogs(name: string, options: { tail?: number, offset?: number } = {}) {
    const executor = this.workflows.get(name);
    if (!executor) {
      throw new Error(`Workflow ${name} not found`);
    }
    const logFile = path.join(executor.dir, 'workflow.json.log');
    if (!fs.existsSync(logFile)) {
      return { content: 'No logs found.', nextOffset: 0 };
    }

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

    const content = fs.readFileSync(logFile, 'utf8');
    const stats = fs.statSync(logFile);
    if (options.tail) {
      const lines = content.trim().split('\n');
      return { content: lines.slice(-options.tail).join('\n') + '\n', nextOffset: stats.size };
    }
    return { content: content, nextOffset: stats.size };
  }
}
