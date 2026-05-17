import { Workflow } from '../common/types';
import * as fs from 'fs';
import * as path from 'path';
import { Sandbox } from '../sandbox';
import * as winston from 'winston';
import { validateWorkflowDir, parseTasks } from '../common/validation';

interface WorkflowRuntime extends Workflow {
  stopHandle?: () => Promise<void>;
}

export class WorkflowManager {
  private workflows: Map<string, WorkflowRuntime> = new Map();
  private loggers: Map<string, winston.Logger> = new Map();
  private sandbox: Sandbox;

  constructor() {
    this.sandbox = new Sandbox();
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

  startWorkflow(name: string, dir: string, configDir?: string) {
    const existing = this.workflows.get(name);
    if (existing && existing.status !== 'Done' && !existing.status.startsWith('Failed')) {
      throw new Error(`Workflow ${name} is already running`);
    }

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const { tasks, pendingTasks } = validateWorkflowDir(dir);

    const workflow: WorkflowRuntime = {
      name,
      dir,
      uptime: Date.now(),
      progress: `${tasks.length - pendingTasks.length}/${tasks.length}`,
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
    const logger = this.getOrCreateLogger(workflow.name, workflow.dir);

    while (workflow.status !== 'Failed' && workflow.status !== 'Done') {
      const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
      const tasks = parseTasks(tasksContent);
      const pendingTasks = tasks.filter(t => !t.completed);

      workflow.progress = `${tasks.length - pendingTasks.length}/${tasks.length}`;

      if (pendingTasks.length === 0) {
        logger.info('All tasks completed');
        workflow.status = 'Done';
        break;
      }

      workflow.status = `Running: Autonomous Agent Loop`;
      workflow.currentTask = 'Autonomous Task Selection';

      let retries = 0;
      const maxRetries = 3;
      let success = false;

      while (retries <= maxRetries && !success) {
        try {
          const run = await this.sandbox.runTask(workflow.name, workflow.dir, workflow.configDir);
          workflow.pid = run.pid;
          workflow.stopHandle = run.stop;
          
          logger.info('Running agent loop', { 
            prompt: run.prompt 
          });

          const result = await run.wait();
          workflow.pid = undefined;
          workflow.stopHandle = undefined;

          if (workflow.status === 'Done' || !workflow.status.startsWith('Running')) {
            // Workflow was killed while waiting
            break;
          }
          
          if (result.exitCode === 0) {
            // Extract token usage if present in logs - more robust regexes
            const tokenPatterns = [
              /usage:\s*{\s*prompt_tokens:\s*(\d+),\s*completion_tokens:\s*(\d+)/i, // JSON-like
              /Token usage:\s+(\d+)\s+prompt,\s+(\d+)\s+completion/i,
              /(\d+)\s*prompt tokens,?\s*(\d+)\s*completion tokens/i,
              /tokens:\s*(\d+)\s*in,\s*(\d+)\s*out/i,
              /input:\s*(\d+),\s*output:\s*(\d+)/i,
              /(?:Tokens|Usage):?\s*(?:input:?\s*)?(\d+)\s+(?:input|prompt)?(?:s)?,?\s*(?:output:?\s*)?(\d+)\s*(?:output|completion)?(?:s)?/i
            ];

            let taskTokenUsage = { input: 0, output: 0, total: 0 };

            for (const pattern of tokenPatterns) {
              const match = result.logs.match(pattern);
              if (match) {
                const input = parseInt(match[1]);
                const output = parseInt(match[2]);
                taskTokenUsage = { input, output, total: input + output };
                workflow.tokenUsage.input += input;
                workflow.tokenUsage.output += output;
                workflow.tokenUsage.total += (input + output);
                break;
              }
            }

            // Check if tasks.md was updated
            const updatedTasksContent = fs.readFileSync(tasksPath, 'utf-8');
            const updatedTasks = parseTasks(updatedTasksContent);
            const postPendingTasks = updatedTasks.filter(t => !t.completed);
            
            const newlyCompletedTasks = pendingTasks.filter(pre => !postPendingTasks.find(post => post.description === pre.description));
            
            if (newlyCompletedTasks.length === 0) {
              throw new Error(`No tasks were marked as completed in tasks.md`);
            }

            // Update task tracking
            newlyCompletedTasks.forEach(t => {
              workflow.recentTasks.unshift(t.description);
            });
            if (workflow.recentTasks.length > 5) {
              workflow.recentTasks.length = 5;
            }
            workflow.currentTask = undefined;

            logger.info('Tasks completed successfully', { 
              completedTasks: newlyCompletedTasks.map(t => t.description), 
              exitCode: result.exitCode,
              output: result.logs,
              tokenUsage: taskTokenUsage,
              workflowTokenUsage: workflow.tokenUsage
            });
            success = true;
          } else {
            // Check for API-specific errors
            const isQuotaError = /429|Too Many Requests|Quota exceeded|Resource has been exhausted/i.test(result.logs);
            const isSafetyError = /Candidate was blocked due to safety/i.test(result.logs);
            
            retries++;
            if (retries <= maxRetries) {
              let delay = Math.pow(2, retries) * 5000;
              
              if (isQuotaError) {
                delay = Math.max(delay, 60000); // Wait at least 60s for quota errors
                logger.warn('Gemini API quota exceeded, waiting longer...', {
                  attempt: retries,
                  nextRetryIn: `${delay / 1000}s`
                });
              } else if (isSafetyError) {
                logger.error('Task blocked by safety filters', {
                  output: result.logs
                });
                workflow.status = 'Failed: Safety Block';
                break;
              } else {
                logger.warn('Agent loop failed, retrying...', { 
                  exitCode: result.exitCode, 
                  attempt: retries,
                  nextRetryIn: `${delay / 1000}s`,
                  output: result.logs
                });
              }
              
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              logger.error('Agent loop failed after max retries', { 
                exitCode: result.exitCode,
                output: result.logs
              });
              workflow.status = 'Failed';
              break;
            }
          }
        } catch (err: any) {
          retries++;
          if (retries <= maxRetries) {
            const delay = Math.pow(2, retries) * 5000;
            logger.error('Sandbox error, retrying...', { 
              error: err.message,
              attempt: retries,
              nextRetryIn: `${delay / 1000}s`
            });
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            logger.error('Sandbox error after max retries', { 
              error: err.message 
            });
            throw err;
          }
        }
      }

      if (workflow.status === 'Failed') break;

      await new Promise(resolve => setTimeout(resolve, 5000)); // Sleep between iterations
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


