/* eslint-disable unicorn/prefer-event-target */
import { Workflow, TaskBoard as ITaskBoard, MilestoneEvent, MILESTONE_STATUS, MILESTONE_TYPE, MilestoneStatus } from '../common/types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitClient, ShellGitClient } from '../common/git';
import { EventEmitter } from 'node:events';

import * as winston from 'winston';
import { TaskBoard } from './task-board';
import { FileSystemTaskStorage } from './task-storage';
import { TaskValidator } from '../common/validation';
import { OutcomeAnalyzer } from './agent-outcome';
import { Agent } from './agent';
import { WorkflowExecutor } from './workflow-executor';
import { WorkflowFileSystem, DefaultWorkflowFileSystem } from './workflow-fs';
import { WorkflowLogger, DefaultWorkflowLogger } from './workflow-logger';

export type AgentFactory = (agentName?: string) => Agent;
export type GitClientFactory = (dir: string) => GitClient;

export class WorkflowManager extends EventEmitter {
  private workflows: Map<string, WorkflowExecutor> = new Map();
  private agentFactory: AgentFactory;
  private taskBoardFactory: (path: string) => ITaskBoard;
  private evaluator: OutcomeAnalyzer;
  private gitClientFactory: GitClientFactory;
  private fileSystem: WorkflowFileSystem;
  private workflowLogger: WorkflowLogger;

  constructor(
    agentFactory: AgentFactory, 
    taskBoardFactory: (path: string) => ITaskBoard = (p) => new TaskBoard(new FileSystemTaskStorage(p), new TaskValidator()),
    evaluator: OutcomeAnalyzer = new OutcomeAnalyzer(),
    gitClientFactory: GitClientFactory = (dir) => new ShellGitClient(dir),
    fileSystem: WorkflowFileSystem = new DefaultWorkflowFileSystem(),
    workflowLogger: WorkflowLogger = new DefaultWorkflowLogger()
  ) {
    super();
    this.agentFactory = agentFactory;
    this.taskBoardFactory = taskBoardFactory;
    this.evaluator = evaluator;
    this.gitClientFactory = gitClientFactory;
    this.fileSystem = fileSystem;
    this.workflowLogger = workflowLogger;

    // Forward 'log' events from workflowLogger
    this.workflowLogger.on('log', (name, info) => {
      this.emit('log', name, info);
    });
  }

  // Retained for tests and internal helper consistency
  private getOrCreateLogger(name: string, dir: string, configDir?: string): winston.Logger {
    return this.workflowLogger.getOrCreateLogger(name, dir, configDir);
  }

  async startWorkflow(name: string, dir: string, options: { configDir?: string, isWorktree?: boolean, sourceRepo?: string, branch?: string, agent?: string } = {}): Promise<Workflow> {
    const existing = this.workflows.get(name);
    if (existing && existing.status !== 'Done' && !existing.status.startsWith('Failed') && existing.status !== 'Killed') {
      throw new Error(`Workflow ${name} is already running`);
    }

    if (!fs.existsSync(dir)) {
      if (options.isWorktree && options.sourceRepo && options.branch) {
        const sourceGit = this.gitClientFactory(options.sourceRepo);
        // Prune dead worktrees first to avoid directory/reference conflicts
        try {
          sourceGit.pruneWorktrees();
        } catch {
          // Ignore worktree prune errors
        }
        // Create the worktree branch. If it exists, checkout, else create it.
        try {
          if (sourceGit.hasBranch(options.branch)) {
            // Branch exists, create worktree from it
            sourceGit.addWorktree(dir, options.branch);
          } else {
            // Branch doesn't exist, create it via worktree add -b
            sourceGit.createWorktree(dir, options.branch);
          }
        } catch (error: any) {
          // Let worktree creation failure bubble up if it fails on both attempts
          throw new Error(`Failed to create git worktree: ${error.message}`, { cause: error });
        }
      } else {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    if (options.isWorktree && options.sourceRepo) {
      const srcPrd = path.join(options.sourceRepo, 'PRD.md');
      const srcTasks = path.join(options.sourceRepo, 'tasks.md');
      const destPrd = path.join(dir, 'PRD.md');
      const destTasks = path.join(dir, 'tasks.md');

      if (fs.existsSync(srcPrd) && !fs.existsSync(destPrd)) {
        this.fileSystem.safeMoveSync(srcPrd, destPrd);
      }
      if (fs.existsSync(srcTasks) && !fs.existsSync(destTasks)) {
        this.fileSystem.safeMoveSync(srcTasks, destTasks);
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

    const logger = this.workflowLogger.getOrCreateLogger(name, dir, options.configDir);
    const agent = this.agentFactory(options.agent);
    const executor = new WorkflowExecutor(
      name,
      dir,
      agent,
      taskBoard,
      logger,
      options.configDir,
      options.isWorktree,
      options.sourceRepo,
      options.branch,
      this.gitClientFactory(dir)
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

  getExecutor(name: string): WorkflowExecutor | undefined {
    return this.workflows.get(name);
  }

  async killWorkflow(name: string) {
    const executor = this.workflows.get(name);
    if (!executor) {
      throw new Error(`Workflow ${name} not found`);
    }
    await executor.kill();
  }

  async removeWorkflow(name: string, onMilestone?: (milestone: MilestoneEvent) => void, deleteDir?: boolean) {
    const executor = this.workflows.get(name);
    if (!executor) {
      this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Workflow ${name} not found`);
      throw new Error(`Workflow ${name} not found`);
    }

    if (executor.status !== 'Done' && !executor.status.startsWith('Failed') && executor.status !== 'Killed') {
      this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Workflow ${name} is still running. Kill it first.`);
      throw new Error(`Workflow ${name} is still running. Kill it first.`);
    }

    this.emitMilestone(onMilestone, MILESTONE_STATUS.STARTING, `Removing workflow ${name}...`);

    const logger = this.workflowLogger.getOrCreateLogger(name, executor.dir, executor.configDir);

    if (executor.isWorktree && executor.sourceRepo) {
      try {
        const destDir = path.join(executor.sourceRepo, '.afk-coder', 'tasks', name);
        fs.mkdirSync(destDir, { recursive: true });

        const srcTasks = path.join(executor.dir, 'tasks.md');
        const srcPrd = path.join(executor.dir, 'PRD.md');

        if (fs.existsSync(srcTasks)) {
          fs.copyFileSync(srcTasks, path.join(destDir, 'tasks.md'));
          this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, `Archived tasks.md to .afk-coder/tasks/${name}/`);
        }
        if (fs.existsSync(srcPrd)) {
          fs.copyFileSync(srcPrd, path.join(destDir, 'PRD.md'));
          this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, `Archived PRD.md to .afk-coder/tasks/${name}/`);
        }
      } catch (error: any) {
        logger.error(`Failed to archive workflow files: ${error.message}`);
        this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, `Failed to archive workflow files: ${error.message}`);
      }
    }

    if (executor.isWorktree && executor.sourceRepo && executor.branch) {
      try {
        const git = executor.git;
        this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Checking for uncommitted changes...');
        if (git.hasChanges()) {
          git.add('.');
          git.reset('tasks.md');
          git.reset('PRD.md');

          if (git.hasStagedChanges()) {
            this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Generating commit message using AI...');
            const commitMsg = await executor.agent.generateCommitMessage(executor.dir, executor.configDir);
            this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, `Committing changes: "${commitMsg}"...`);
            git.commit(commitMsg);
          } else {
            this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'No other changes to commit.');
          }
        }
      } catch (error: any) {
        logger.error(`Failed to auto-commit changes before removing workflow: ${error.message}`);
        this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, `Skipped auto-commit due to error: ${error.message}`);
      }
    }

    if (executor.isWorktree && executor.sourceRepo) {
      try {
        if (deleteDir) {
          this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Deleting git worktree...');
          const sourceGit = this.gitClientFactory(executor.sourceRepo);
          try {
            sourceGit.removeWorktree(executor.dir);
          } catch (gitError: any) {
            logger.warn(`Initial worktree removal failed: ${gitError.message}. Attempting permission fix...`);
            this.fileSystem.ensureDirectoryWritable(executor.dir, executor.configDir, logger, onMilestone);
            this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Retrying git worktree removal...');
            sourceGit.removeWorktree(executor.dir);
          }
        } else {
          this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Untracking git worktree...');
          const gitPointerPath = path.join(executor.dir, '.git');
          if (fs.existsSync(gitPointerPath)) {
            fs.rmSync(gitPointerPath, { force: true });
          }
          const sourceGit = this.gitClientFactory(executor.sourceRepo);
          sourceGit.pruneWorktrees();
        }
      } catch (error: any) {
        logger.error(`Failed to remove/untrack worktree: ${error.message}`);
        this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Failed to remove/untrack git worktree: ${error.message}`);
        throw error;
      }
    } else if (!executor.isWorktree && deleteDir) {
      try {
        this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Deleting workflow directory...');
        this.fileSystem.deleteDirectory(executor.dir, executor.configDir, logger, onMilestone);
      } catch (error: any) {
        logger.error(`Failed to delete directory: ${error.message}`);
        this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Failed to delete directory: ${error.message}`);
        throw error;
      }
    }

    this.workflows.delete(name);
    this.workflowLogger.removeLogger(name);
    this.emitMilestone(onMilestone, MILESTONE_STATUS.COMPLETED, `Workflow ${name} successfully removed.`);
  }

  async init(args: { dir: string, prd: string, force?: boolean, configDir?: string, agent?: string }, onMilestone?: (milestone: MilestoneEvent) => void) {
    const agent = this.agentFactory(args.agent);
    return await agent.generateTasks(args.dir, args.prd, args.force, args.configDir, onMilestone);
  }

  getLogs(name?: string, options: { tail?: number, offset?: number, daemon?: boolean } = {}) {
    return this.workflowLogger.getLogs(name, options, (wfName) => {
      const executor = this.workflows.get(wfName);
      return executor?.configDir;
    });
  }

  private emitMilestone(
    onMilestone: ((event: MilestoneEvent) => void) | undefined,
    status: MilestoneStatus,
    message: string
  ) {
    if (onMilestone) {
      onMilestone({
        type: MILESTONE_TYPE,
        status,
        message,
        timestamp: new Date().toISOString()
      });
    }
  }
}

