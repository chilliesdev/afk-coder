import * as fs from 'fs';
import * as path from 'path';
import { ExecutionRuntime } from './execution-runtime';
import { AgentStrategy } from './agent-strategy';

export class TaskGenerator {
  private runtime: ExecutionRuntime;
  private strategy: AgentStrategy;

  constructor(runtime: ExecutionRuntime, strategy: AgentStrategy) {
    this.runtime = runtime;
    this.strategy = strategy;
  }

  /**
   * Generates tasks.md from a PRD file using the execution runtime.
   * Runs as a synchronous IPC action.
   */
  async generate(
    dir: string,
    prdFilename: string,
    force?: boolean,
    configDir?: string
  ): Promise<{ success: boolean; logs?: string; error?: string }> {
    const resolvedDir = path.resolve(dir);
    const prdPath = path.join(resolvedDir, prdFilename);
    const tasksPath = path.join(resolvedDir, 'tasks.md');

    if (!fs.existsSync(prdPath)) {
      return { success: false, error: `${prdFilename} not found in ${resolvedDir}` };
    }

    if (fs.existsSync(tasksPath) && !force) {
      return { success: false, error: `tasks.md already exists in ${resolvedDir}. Use --force to overwrite.` };
    }

    // Pre-create the file to ensure it is owned by the daemon process owner, not root in container
    try {
      fs.writeFileSync(tasksPath, '');
    } catch (err: any) {
      return { success: false, error: `Failed to create tasks.md: ${err.message}` };
    }

    try {
      const prompt = this.strategy.getTaskGenerationPrompt(prdFilename);
      const run = await this.runtime.run(prompt, resolvedDir, configDir);
      const result = await run.wait();

      if (result.exitCode === 0) {
        if (fs.existsSync(tasksPath)) {
          const content = fs.readFileSync(tasksPath, 'utf8');
          if (content.trim() === '') {
            // If the file is still empty, the sandbox didn't write to it directly.
            // Let's try to parse stdout.
            const lines = result.logs.split('\n').filter(l => l.trim().startsWith('- [ ]'));
            if (lines.length > 0) {
              fs.writeFileSync(tasksPath, lines.join('\n'));
              return { success: true, logs: 'Successfully generated tasks.md (from stdout)' };
            } else {
              // Clean up empty file
              fs.unlinkSync(tasksPath);
              return { success: false, error: 'No tasks found in output', logs: result.logs };
            }
          } else {
            return { success: true, logs: 'Successfully generated tasks.md' };
          }
        } else {
          return { success: false, error: 'File disappeared during generation' };
        }
      } else {
        // Clean up empty file if generation failed
        if (fs.existsSync(tasksPath) && fs.readFileSync(tasksPath, 'utf8').trim() === '') {
          fs.unlinkSync(tasksPath);
        }
        return { success: false, error: `Exit code ${result.exitCode}`, logs: result.logs };
      }
    } catch (err: any) {
      // Clean up empty file if exception thrown
      if (fs.existsSync(tasksPath) && fs.readFileSync(tasksPath, 'utf8').trim() === '') {
        fs.unlinkSync(tasksPath);
      }
      return { success: false, error: err.message };
    }
  }
}
