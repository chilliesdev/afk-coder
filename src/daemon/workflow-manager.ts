import { Workflow, TaskBoard as ITaskBoard, MilestoneEvent, MILESTONE_STATUS, MILESTONE_TYPE, MilestoneStatus } from '../common/types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitClient, ShellGitClient } from '../common/git';

import * as winston from 'winston';
import { TaskBoard } from './task-board';
import { FileSystemTaskStorage } from './task-storage';
import { TaskValidator } from '../common/validation';
import { OutcomeAnalyzer } from './agent-outcome';
import { Agent } from './agent';
import { WorkflowExecutor } from './workflow-executor';

export type AgentFactory = (agentName?: string) => Agent;
export type GitClientFactory = (dir: string) => GitClient;

export class WorkflowManager {
  private workflows: Map<string, WorkflowExecutor> = new Map();
  private loggers: Map<string, winston.Logger> = new Map();
  private agentFactory: AgentFactory;
  private taskBoardFactory: (path: string) => ITaskBoard;
  private evaluator: OutcomeAnalyzer;
  private gitClientFactory: GitClientFactory;

  constructor(
    agentFactory: AgentFactory, 
    taskBoardFactory: (path: string) => ITaskBoard = (p) => new TaskBoard(new FileSystemTaskStorage(p), new TaskValidator()),
    evaluator: OutcomeAnalyzer = new OutcomeAnalyzer(),
    gitClientFactory: GitClientFactory = (dir) => new ShellGitClient(dir)
  ) {
    this.agentFactory = agentFactory;
    this.taskBoardFactory = taskBoardFactory;
    this.evaluator = evaluator;
    this.gitClientFactory = gitClientFactory;
  }

  private getOrCreateLogger(name: string, dir: string, configDir?: string): winston.Logger {
    if (this.loggers.has(name)) {
      return this.loggers.get(name)!;
    }

    const { ConfigManager, getLogsDir } = require('../common/config');
    const configManager = new ConfigManager(configDir);
    const config = configManager.loadConfig();
    const logsDir = getLogsDir(config);

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFile = path.join(logsDir, `${name}.json.log`);

    let maxSize = 10 * 1024 * 1024; // 10MB default
    let maxFiles = 5;

    if (config.daemon?.logRotation?.maxSize !== undefined) {
      const sizeVal = Number(config.daemon.logRotation.maxSize);
      if (!isNaN(sizeVal) && sizeVal >= 0) {
        maxSize = sizeVal;
      }
    }
    if (config.daemon?.logRotation?.maxFiles !== undefined) {
      const filesVal = Number(config.daemon.logRotation.maxFiles);
      if (!isNaN(filesVal) && filesVal >= 0) {
        maxFiles = filesVal;
      }
    }

    const logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { workflow: name },
      transports: [
        new winston.transports.File({
          filename: logFile,
          maxsize: maxSize,
          maxFiles: maxFiles,
          tailable: true,
        }),
      ],
    });

    this.loggers.set(name, logger);
    return logger;
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
        fs.copyFileSync(srcPrd, destPrd);
      }
      if (fs.existsSync(srcTasks) && !fs.existsSync(destTasks)) {
        fs.copyFileSync(srcTasks, destTasks);
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

    const logger = this.getOrCreateLogger(name, dir, options.configDir);
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

    const logger = this.loggers.get(name);

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
        logger?.error(`Failed to archive workflow files: ${error.message}`);
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
        logger?.error(`Failed to auto-commit changes before removing workflow: ${error.message}`);
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
            logger?.warn(`Initial worktree removal failed: ${gitError.message}. Attempting permission fix...`);
            this.ensureDirectoryWritable(executor.dir, executor.configDir, logger, onMilestone);
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
        logger?.error(`Failed to remove/untrack worktree: ${error.message}`);
        this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Failed to remove/untrack git worktree: ${error.message}`);
        throw error;
      }
    } else if (!executor.isWorktree && deleteDir) {
      try {
        this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Deleting workflow directory...');
        if (fs.existsSync(executor.dir)) {
          try {
            fs.rmSync(executor.dir, { recursive: true, force: true });
          } catch (fsError: any) {
            logger?.warn(`Initial directory deletion failed: ${fsError.message}. Attempting permission fix...`);
            this.ensureDirectoryWritable(executor.dir, executor.configDir, logger, onMilestone);
            this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Retrying directory deletion...');
            fs.rmSync(executor.dir, { recursive: true, force: true });
          }
        }
      } catch (error: any) {
        logger?.error(`Failed to delete directory: ${error.message}`);
        this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Failed to delete directory: ${error.message}`);
        throw error;
      }
    }

    this.workflows.delete(name);
    this.loggers.delete(name);
    this.emitMilestone(onMilestone, MILESTONE_STATUS.COMPLETED, `Workflow ${name} successfully removed.`);
  }

  async init(args: { dir: string, prd: string, force?: boolean, configDir?: string, agent?: string }, onMilestone?: (milestone: MilestoneEvent) => void) {
    const agent = this.agentFactory(args.agent);
    return await agent.generateTasks(args.dir, args.prd, args.force, args.configDir, onMilestone);
  }

  getLogs(name: string, options: { tail?: number, offset?: number } = {}) {
    const executor = this.workflows.get(name);
    if (!executor) {
      throw new Error(`Workflow ${name} not found`);
    }
    const { ConfigManager, getLogsDir } = require('../common/config');
    const configManager = new ConfigManager(executor.configDir);
    const config = configManager.loadConfig();
    const logsDir = getLogsDir(config);
    const logFile = path.join(logsDir, `${name}.json.log`);
    if (!fs.existsSync(logFile)) {
      return { content: 'No logs found.', nextOffset: 0 };
    }

    const filterLogs = (rawContent: string): string => {
      const lines = rawContent.split('\n');
      const filtered = lines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        try {
          const parsed = JSON.parse(trimmed);
          return parsed.workflow === name;
        } catch {
          return trimmed.includes(name);
        }
      });
      return filtered.join('\n') + (filtered.length > 0 ? '\n' : '');
    };

    if (options.offset !== undefined) {
      const stats = fs.statSync(logFile);
      if (options.offset >= stats.size) {
        return { content: '', nextOffset: stats.size };
      }
      const fd = fs.openSync(logFile, 'r');
      const buffer = Buffer.alloc(stats.size - options.offset);
      fs.readSync(fd, buffer, 0, buffer.length, options.offset);
      fs.closeSync(fd);
      const filteredContent = filterLogs(buffer.toString('utf-8'));
      return { content: filteredContent, nextOffset: stats.size };
    }

    const content = fs.readFileSync(logFile, 'utf8');
    const stats = fs.statSync(logFile);
    const filteredContent = filterLogs(content);
    if (options.tail) {
      const lines = filteredContent.trim().split('\n');
      const filteredLines = filteredContent.trim() ? lines : [];
      return { content: filteredLines.slice(-options.tail).join('\n') + (filteredLines.length > 0 ? '\n' : ''), nextOffset: stats.size };
    }
    return { content: filteredContent, nextOffset: stats.size };
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

  private ensureDirectoryWritable(
    dir: string,
    configDir?: string,
    logger?: winston.Logger,
    onMilestone?: (milestone: MilestoneEvent) => void
  ) {
    try {
      const uid = process.getuid ? process.getuid() : 1000;
      const gid = process.getgid ? process.getgid() : 1000;

      const { ConfigManager } = require('../common/config');
      const configManager = new ConfigManager(configDir);
      const config = configManager.loadConfig();
      const image = config.sandbox?.image || 'us-docker.pkg.dev/gemini-code-dev/gemini-cli/sandbox:0.41.0';

      this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Fixing worktree directory permissions using Docker...');
      
      const resolvedDir = path.resolve(dir);
      const parentDir = path.dirname(resolvedDir);
      const baseName = path.basename(resolvedDir);

      const { execSync } = require('node:child_process');
      execSync(
        `docker run --rm -v "${parentDir}:/workspace" -w /workspace ${image} chown -R ${uid}:${gid} "${baseName}"`,
        { stdio: 'ignore' }
      );
    } catch (error: any) {
      logger?.error(`Failed to change directory permissions via Docker: ${error.message}`);
      this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, `Docker permission fix failed: ${error.message}`);
    }
  }
}
