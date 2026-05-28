import * as fs from 'node:fs';
import * as path from 'node:path';
import { ExecutionRuntime, RuntimeHandle } from './execution-runtime';
import { TaskValidator } from '../common/validation';
import { OutcomeAnalyzer } from './agent-outcome';
import { Task, TokenUsage, TaskBoard as ITaskBoard, MilestoneEvent, MilestoneStatus, MILESTONE_TYPE, MILESTONE_STATUS } from '../common/types';
import * as winston from 'winston';
import { AgentAdapter } from './agent-adapter';

export interface AgentPhaseResult {
  success: boolean;
  tokenUsage: TokenUsage;
  newlyCompletedTasks?: Task[];
  error?: string;
}

export class Agent {
  private currentRun?: RuntimeHandle;
  private activeDelayTimeout?: NodeJS.Timeout;
  private isKilled: boolean = false;

  constructor(
    private readonly runtime: ExecutionRuntime,
    private readonly analyzer: OutcomeAnalyzer,
    private readonly adapter: AgentAdapter
  ) {}

  async start(dir: string, configDir?: string): Promise<void> {
    if (this.runtime.start) {
      await this.runtime.start(dir, configDir);
    }
  }

  async stop(): Promise<void> {
    if (this.runtime.stop) {
      await this.runtime.stop();
    }
  }

  async kill() {
    this.isKilled = true;
    if (this.activeDelayTimeout) {
      clearTimeout(this.activeDelayTimeout);
      this.activeDelayTimeout = undefined;
    }
    if (this.currentRun) {
      await this.currentRun.stop();
      this.currentRun = undefined;
    }
    await this.stop();
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.activeDelayTimeout = setTimeout(() => {
        this.activeDelayTimeout = undefined;
        resolve();
      }, ms);
    });
  }

  async executeCodingLoop(dir: string, taskBoard: ITaskBoard, configDir?: string, logger?: winston.Logger): Promise<AgentPhaseResult> {
    let retries = 0;
    const tokenUsage = { input: 0, output: 0, total: 0 };
    this.isKilled = false;

    while (!this.isKilled) {
      try {
        const prompt = this.adapter.getAutonomousLoopCommand();
        this.currentRun = await this.runtime.run(prompt, dir, configDir);
        
        if (logger) {
          logger.info('Running agent loop', { prompt: this.currentRun.prompt });
        }

        const result = await this.currentRun.wait();
        this.currentRun = undefined;

        if (this.isKilled) break;

        let newlyCompleted: Task[] = [];
        if (result.exitCode === 0) {
          const reconciliation = await taskBoard.reconcile();
          newlyCompleted = reconciliation.newlyCompleted;
        }

        const decision = this.analyzer.analyze(
          result.logs || '',
          result.exitCode,
          retries,
          newlyCompleted.length
        );

        result.logs = this.cleanAgentLogs(result.logs || '');

        tokenUsage.input += decision.tokens.input;
        tokenUsage.output += decision.tokens.output;
        tokenUsage.total += decision.tokens.total;

        if (decision.action === 'next') {
          if (logger) {
            logger.info('Tasks completed successfully', { 
              completedTasks: newlyCompleted.map(t => t.description), 
              exitCode: result.exitCode,
              output: result.logs,
              tokenUsage: decision.tokens
            });
          }
          await this.delay(decision.delayMs);
          return { success: true, tokenUsage, newlyCompletedTasks: newlyCompleted };
        }

        if (decision.action === 'retry') {
          retries++;
          if (logger) {
            if (decision.error?.type === 'Quota') {
              logger.warn('Gemini API quota exceeded, waiting longer...', { attempt: retries, nextRetryIn: `${decision.delayMs / 1000}s` });
            } else {
              logger.warn('Agent loop failed, retrying...', { exitCode: result.exitCode, attempt: retries, nextRetryIn: `${decision.delayMs / 1000}s`, output: result.logs });
            }
          }
          await this.delay(decision.delayMs);
          continue;
        }

        if (logger) {
          if (decision.error?.type === 'Safety') {
            logger.error('Task blocked by safety filters', { output: result.logs });
          } else if (decision.error?.type === 'NoProgress') {
            logger.error('Agent reported no progress', { output: result.logs });
          } else {
            logger.error('Agent loop failed after max retries', { exitCode: result.exitCode, output: result.logs, error: decision.error?.message });
          }
        }
        const errorMessage = decision.error?.type === 'Safety' 
          ? 'Safety Block' 
          : (decision.error?.type === 'NoProgress' ? 'No Progress' : decision.error?.message || 'Agent loop failed');
        return { success: false, tokenUsage, error: errorMessage };
      } catch (error: any) {
        const decision = this.analyzer.analyze(error.message || '', -1, retries, 0);
        if (decision.action === 'retry') {
          retries++;
          if (logger) logger.error('Runtime error, retrying...', { error: error.message, attempt: retries, nextRetryIn: `${decision.delayMs / 1000}s` });
          await this.delay(decision.delayMs);
          continue;
        }
        if (logger) logger.error('Runtime error after max retries', { error: error.message });
        return { success: false, tokenUsage, error: error.message };
      }
    }

    return { success: false, tokenUsage, error: 'Agent killed' };
  }

  async executeQALoop(dir: string, taskBoard: ITaskBoard, configDir?: string, logger?: winston.Logger): Promise<AgentPhaseResult> {
    let retries = 0;
    const tokenUsage = { input: 0, output: 0, total: 0 };
    this.isKilled = false;

    while (!this.isKilled) {
      try {
        const prompt = this.adapter.getQALoopCommand();
        this.currentRun = await this.runtime.run(prompt, dir, configDir);
        
        if (logger) {
          logger.info('Running QA agent loop', { prompt: this.currentRun.prompt });
        }

        const result = await this.currentRun.wait();
        this.currentRun = undefined;

        if (this.isKilled) break;

        const cleanLogs = this.cleanAgentLogs(result.logs || '');

        if (result.exitCode === 0) {
          const parsed = this.analyzer.parseAgentOutput(result.logs || '', result.exitCode);
          tokenUsage.input += parsed.tokens.input;
          tokenUsage.output += parsed.tokens.output;
          tokenUsage.total += parsed.tokens.total;
          result.logs = cleanLogs;
          return { success: true, tokenUsage };
        }
        
        const decision = this.analyzer.analyze(result.logs || '', result.exitCode, retries, 0);
        tokenUsage.input += decision.tokens.input;
        tokenUsage.output += decision.tokens.output;
        tokenUsage.total += decision.tokens.total;

        result.logs = cleanLogs;

        if (decision.action === 'retry') {
          retries++;
          if (logger) {
            logger.warn('QA Agent loop failed, retrying...', { exitCode: result.exitCode, attempt: retries, nextRetryIn: `${decision.delayMs / 1000}s` });
          }
          await this.delay(decision.delayMs);
          continue;
        }

        if (logger) logger.error('QA Agent loop failed after max retries', { exitCode: result.exitCode, output: result.logs });
        return { success: false, tokenUsage, error: decision.error?.message || 'QA Agent loop failed' };
      } catch (error: any) {
        const decision = this.analyzer.analyze(error.message || '', -1, retries, 0);
        if (decision.action === 'retry') {
          retries++;
          if (logger) logger.error('QA Agent runtime error', { error: error.message });
          await this.delay(decision.delayMs);
          continue;
        }
        if (logger) logger.error('QA Agent runtime error', { error: error.message });
        return { success: false, tokenUsage, error: error.message };
      }
    }
    return { success: false, tokenUsage, error: 'Agent killed' };
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

  async generateTasks(
    dir: string,
    prdFilename: string,
    force?: boolean,
    configDir?: string,
    onMilestone?: (event: MilestoneEvent) => void
  ): Promise<{ success: boolean; logs?: string; error?: string }> {
    const resolvedDir = path.resolve(dir);
    const prdPath = path.join(resolvedDir, prdFilename);
    const tasksPath = path.join(resolvedDir, 'tasks.md');

    this.emitMilestone(onMilestone, MILESTONE_STATUS.STARTING, 'Starting task generation...');

    if (!fs.existsSync(prdPath)) {
      this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `PRD not found: ${prdFilename}`);
      return { success: false, error: `${prdFilename} not found in ${resolvedDir}` };
    }

    if (fs.existsSync(tasksPath) && !force) {
      this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, 'tasks.md already exists');
      return { success: false, error: `tasks.md already exists in ${resolvedDir}. Use --force to overwrite.` };
    }

    try {
      fs.writeFileSync(tasksPath, '');
    } catch (error: any) {
      this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Failed to create tasks.md: ${error.message}`);
      return { success: false, error: `Failed to create tasks.md: ${error.message}` };
    }

    try {
      this.emitMilestone(onMilestone, MILESTONE_STATUS.STARTING, 'Starting execution runtime...');
      await this.start(resolvedDir, configDir);
      this.emitMilestone(onMilestone, MILESTONE_STATUS.COMPLETED, 'Execution runtime started');
    } catch (error: any) {
      if (fs.existsSync(tasksPath) && fs.readFileSync(tasksPath, 'utf8').trim() === '') {
        fs.unlinkSync(tasksPath);
      }
      this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Failed to start runtime: ${error.message}`);
      return { success: false, error: `Failed to start execution runtime: ${error.message}` };
    }

    try {
      this.emitMilestone(onMilestone, MILESTONE_STATUS.STARTING, 'Analyzing PRD and generating tasks...');
      const prompt = this.adapter.getTaskGenerationCommand(prdFilename);
      const run = await this.runtime.run(prompt, resolvedDir, configDir);
      const result = await run.wait();

      if (result.exitCode !== 0) {
        if (fs.existsSync(tasksPath) && fs.readFileSync(tasksPath, 'utf8').trim() === '') {
          fs.unlinkSync(tasksPath);
        }
        this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Generation failed with exit code ${result.exitCode}`);
        return { success: false, error: `Exit code ${result.exitCode}`, logs: result.logs };
      }

      if (!fs.existsSync(tasksPath)) {
        this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, 'tasks.md disappeared during generation');
        return { success: false, error: 'File disappeared during generation' };
      }

      let content = fs.readFileSync(tasksPath, 'utf8');
      if (content.trim() === '') {
        this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Parsing tasks from agent output...');
        const validator = new TaskValidator();
        const tasks = validator.parseTasks(result.logs);
        if (tasks.length === 0) {
          fs.unlinkSync(tasksPath);
          this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, 'No tasks found in output');
          return { success: false, error: 'No tasks found in output', logs: result.logs };
        }

        const lines = tasks.map(t => `- [${t.completed ? 'x' : ' '}] ${t.description}`);
        content = lines.join('\n');
        fs.writeFileSync(tasksPath, content);
      }

      this.emitMilestone(onMilestone, MILESTONE_STATUS.COMPLETED, 'Analyzing PRD and generating tasks...');

      this.emitMilestone(onMilestone, MILESTONE_STATUS.STARTING, 'Validating generated tasks...');
      try {
        const validator = new TaskValidator();
        validator.validateTasks(content);
        this.emitMilestone(onMilestone, MILESTONE_STATUS.COMPLETED, 'Tasks validated');
      } catch (error: any) {
        this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Validation failed: ${error.message}`);
        return { success: false, error: `Validation failed: ${error.message}`, logs: result.logs };
      }

      this.emitMilestone(onMilestone, MILESTONE_STATUS.STARTING, 'Finalizing task generation...');
      this.emitMilestone(onMilestone, MILESTONE_STATUS.COMPLETED, 'Successfully generated tasks.md');
      return { success: true, logs: 'Successfully generated tasks.md' };
    } catch (error: any) {
      if (fs.existsSync(tasksPath) && fs.readFileSync(tasksPath, 'utf8').trim() === '') {
        fs.unlinkSync(tasksPath);
      }
      this.emitMilestone(onMilestone, MILESTONE_STATUS.FAILED, `Error: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      await this.stop();
    }
  }

  // To support old tests assuming runAutonomousLoop and runQALoop are just wrappers:
  async runAutonomousLoop(dir: string, configDir?: string): Promise<RuntimeHandle> {
    const prompt = this.adapter.getAutonomousLoopCommand();
    return this.runtime.run(prompt, dir, configDir);
  }

  async runQALoop(dir: string, configDir?: string): Promise<RuntimeHandle> {
    const prompt = this.adapter.getQALoopCommand();
    return this.runtime.run(prompt, dir, configDir);
  }

  async generateCommitMessage(dir: string, configDir?: string): Promise<string> {
    const defaultMessage = 'chore: auto-commit before workflow removal';
    try {
      if (this.runtime.start) {
        await this.runtime.start(dir, configDir);
      }
      
      const prompt = this.adapter.getCommitMessageCommand();
      const run = await this.runtime.run(prompt, dir, configDir);
      const result = await run.wait();
      
      if (result.exitCode !== 0 || !result.logs) {
        return defaultMessage;
      }
      
      const cleanMessage = result.logs.trim().replaceAll(/^['"\s]+|['"\s]+$/g, '').split('\n')[0].trim();
      return cleanMessage || defaultMessage;
    } catch {
      return defaultMessage;
    } finally {
      try {
        await this.stop();
      } catch {
        // Ignore stop errors
      }
    }
  }

  private cleanAgentLogs(logs: string): string {
    const jsonStart = logs.indexOf('{');
    const jsonEnd = logs.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      try {
        const parsed = JSON.parse(logs.slice(jsonStart, jsonEnd + 1));
        if (parsed && typeof parsed === 'object' && parsed.response !== undefined) {
          return parsed.response;
        }
      } catch {
        // Keep logs as is
      }
    }
    return logs;
  }
}

