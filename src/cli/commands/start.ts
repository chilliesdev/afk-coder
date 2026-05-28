import { Command } from 'commander';
import * as path from 'node:path';
import { BaseCommand } from './base';
import { ShellGitClient, GitClient } from '../../common/git';

export class StartCommand extends BaseCommand {
  private getGitClient(dir: string): GitClient {
    if (this.context.gitClientFactory) {
      return this.context.gitClientFactory(dir);
    }
    return new ShellGitClient(dir);
  }

  register(program: Command): void {
    program
      .command('start <workflow_name>')
      .description('Start a new workflow')
      .option('--dir <path>', 'Implementation directory')
      .option('-w, --worktree', 'Create a git worktree for this workflow')
      .option('--branch <name>', 'Branch name to use for the worktree')
      .option('--agent <name>', 'Agent adapter to use (e.g., gemini, aider)')
      .action(async (workflowName, options) => {
        await this.execute(workflowName, options);
      });
  }

  async execute(workflowName: string, options: any): Promise<void> {
    try {
      let dir: string;
      let sourceRepo: string | undefined;
      let branch: string | undefined;

      if (options.worktree) {
        try {
          const gitClient = this.getGitClient(process.cwd());
          sourceRepo = gitClient.getTopLevel();
        } catch {
          console.error('Validation failed: --worktree must be run from inside a git repository');
          return;
        }

        const { randomBytes } = await import('node:crypto');
        const randomSuffix = randomBytes(3).toString('hex');

        branch = options.branch || `${workflowName}-${randomSuffix}`;
        dir = options.dir ? path.resolve(options.dir) : path.resolve(sourceRepo, '.afk-coder', 'worktrees', `${workflowName}-${randomSuffix}`);
      } else {
        dir = path.resolve(options.dir || '.');
      }

      // Validate locally before sending to daemon
      try {
        if (!options.worktree) {
          this.context.validator.validateWorkflowDir(dir);
        }
      } catch (error: any) {
        console.error(`Validation failed: ${error.message}`);
        return;
      }

      const { CONFIG_DIR } = await import('../../common/config');
      const response = await this.context.client.sendCommand('start', { 
        name: workflowName, 
        dir,
        configDir: CONFIG_DIR,
        isWorktree: options.worktree,
        sourceRepo,
        branch,
        agent: options.agent
      });
      if (!response.success) {
        console.error(`Failed to start workflow: ${response.message}`);
        return;
      }
      if (options.worktree) {
        try {
          const gitClient = this.getGitClient(sourceRepo || process.cwd());
          gitClient.addSafeDirectory(dir);
        } catch (error: any) {
          console.warn(`Warning: Could not configure git safe.directory for ${dir}: ${error.message}`);
        }
      }
      console.log(`Workflow ${workflowName} started successfully.`);
    } catch (error: any) {
      console.error(error.message);
    }
  }
}
