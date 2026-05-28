import { Command } from 'commander';
import { BaseCommand } from './base';
import { Spinner } from '../ui';
import { MILESTONE_STATUS } from '../../common/types';
import { ShellGitClient, GitClient } from '../../common/git';

export class RemoveCommand extends BaseCommand {
  private getGitClient(dir: string): GitClient {
    if (this.context.gitClientFactory) {
      return this.context.gitClientFactory(dir);
    }
    return new ShellGitClient(dir);
  }

  register(program: Command): void {
    program
      .command('remove <workflow_name>')
      .description('Remove a finished or failed workflow from the daemon')
      .option('-d, --delete-dir', 'Delete the worktree directory from disk')
      .action(async (workflowName, options) => {
        await this.execute(workflowName, options);
      });
  }

  async execute(workflowName: string, options: any): Promise<void> {
    const spinner = new Spinner('Checking workflow status...');
    spinner.start();
    try {
      // Fetch workflow info to see if it is a worktree or standard workflow
      const statusResponse = await this.context.client.sendCommand('status', { name: workflowName });
      if (!statusResponse.success) {
        spinner.stop(`Failed to remove workflow: ${statusResponse.message}`, false);
        return;
      }
      const wf = statusResponse.data;

      if (options.deleteDir && !wf.isWorktree) {
        spinner.stop(); // Stop spinner to prevent overlapping with prompt
        const readline = await import('node:readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Are you sure you want to delete the directory "${wf.dir}"? (y/N): `, (ans) => {
            resolve(ans.trim().toLowerCase());
          });
        });
        rl.close();
        if (answer !== 'y' && answer !== 'yes') {
          console.log('Aborted.');
          return;
        }
        spinner.start('Connecting to daemon...');
      } else {
        spinner.update('Connecting to daemon...');
      }

      const response = await this.context.client.sendCommand('remove', { name: workflowName, deleteDir: !!options.deleteDir }, (milestone) => {
        switch (milestone.status) {
          case MILESTONE_STATUS.STARTING: {
            spinner.start(milestone.message);
            break;
          }
          case MILESTONE_STATUS.INFO: {
            spinner.update(milestone.message);
            break;
          }
          case MILESTONE_STATUS.COMPLETED: {
            spinner.stop(milestone.message, true);
            break;
          }
          case MILESTONE_STATUS.FAILED: {
            spinner.stop(milestone.message, false);
            break;
          }
        }
      });
      if (!response.success) {
        spinner.stop(`Failed to remove workflow: ${response.message}`, false);
        return;
      }
      if (response.data && response.data.isWorktree && response.data.dir) {
        try {
          const gitClient = this.getGitClient(process.cwd());
          gitClient.removeSafeDirectory(response.data.dir);
        } catch {
          // Ignore errors
        }
      }
      spinner.stop(`Workflow ${workflowName} removed.`, true);
    } catch (error: any) {
      spinner.stop(`Error: ${error.message}`, false);
    } finally {
      spinner.stop();
    }
  }
}
