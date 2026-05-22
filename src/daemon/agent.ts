import * as fs from 'node:fs';
import * as path from 'node:path';
import { ExecutionRuntime, RuntimeHandle } from './execution-runtime';

export class Agent {
  constructor(private readonly runtime: ExecutionRuntime) {}

  /**
   * Runs the autonomous agent loop in the specified workspace directory.
   */
  async runAutonomousLoop(dir: string, configDir?: string): Promise<RuntimeHandle> {
    const prompt = this.getAutonomousLoopPrompt();
    return this.runtime.run(prompt, dir, configDir);
  }

  /**
   * Runs the QA loop in the specified workspace directory.
   */
  async runQALoop(dir: string, configDir?: string): Promise<RuntimeHandle> {
    const prompt = this.getQALoopPrompt();
    return this.runtime.run(prompt, dir, configDir);
  }

  /**
   * Generates tasks.md from a PRD file using the execution runtime.
   */
  async generateTasks(
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
    } catch (error: any) {
      return { success: false, error: `Failed to create tasks.md: ${error.message}` };
    }

    try {
      const prompt = this.getTaskGenerationPrompt(prdFilename);
      const run = await this.runtime.run(prompt, resolvedDir, configDir);
      const result = await run.wait();

      if (result.exitCode !== 0) {
        // Clean up empty file if generation failed
        if (fs.existsSync(tasksPath) && fs.readFileSync(tasksPath, 'utf8').trim() === '') {
          fs.unlinkSync(tasksPath);
        }
        return { success: false, error: `Exit code ${result.exitCode}`, logs: result.logs };
      }

      if (!fs.existsSync(tasksPath)) {
        return { success: false, error: 'File disappeared during generation' };
      }

      const content = fs.readFileSync(tasksPath, 'utf8');
      if (content.trim() !== '') {
        return { success: true, logs: 'Successfully generated tasks.md' };
      }

      // If the file is still empty, the sandbox didn't write to it directly.
      // Let's try to parse stdout.
      const lines = result.logs.split('\n').filter(l => l.trim().startsWith('- [ ]'));
      if (lines.length === 0) {
        // Clean up empty file
        fs.unlinkSync(tasksPath);
        return { success: false, error: 'No tasks found in output', logs: result.logs };
      }

      fs.writeFileSync(tasksPath, lines.join('\n'));
      return { success: true, logs: 'Successfully generated tasks.md (from stdout)' };
    } catch (error: any) {
      // Clean up empty file if exception thrown
      if (fs.existsSync(tasksPath) && fs.readFileSync(tasksPath, 'utf8').trim() === '') {
        fs.unlinkSync(tasksPath);
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Returns the prompt for the autonomous agent loop.
   */
  private getAutonomousLoopPrompt(): string {
    return `gemini --yolo --prompt "Open tasks.md and identify the highest priority uncompleted task (marked with '- [ ]'). Your objective is to implement the necessary code for this task. Explore the codebase, write the code, and thoroughly verify your changes. Once completed and verified, open tasks.md again and mark ONLY that specific task as done by changing '- [ ]' to '- [x]'. Do not work on multiple tasks at once. Exit the session when finished."`;
  }

  /**
   * Returns the prompt for generating tasks.md from PRD.md.
   */
  private getTaskGenerationPrompt(prdFilename: string): string {
    return String.raw`gemini --yolo --prompt "Read the ${prdFilename} file. Break down the requirements into granular, actionable implementation tasks. Create a new file named tasks.md and write the tasks into it. Format each task exactly as \"- [ ] Task description\". Do not output the tasks to the console; you must write them directly to the tasks.md file."`;
  }

  /**
   * Returns the prompt for the QA loop.
   */
  private getQALoopPrompt(): string {
    return `gemini --yolo --prompt "Read the PRD.md file and examine the codebase. Start the application if necessary to test it, and interact with it through external channels (e.g. HTTP, curl) as an end user would. Verify that all requirements in PRD.md are met. If you find any failures, bugs, or missing requirements, append them as new, uncompleted tasks to the end of tasks.md. Every new task must be formatted exactly as '- [ ] Task description [PRD: section or requirement name]'. Do NOT add any tasks that go beyond the scope of PRD.md. If all tests pass and there are no gaps, do not modify tasks.md. Exit when finished."`;
  }
}
