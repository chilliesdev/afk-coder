import { Command } from 'commander';
import * as path from 'node:path';
import { BaseCommand } from './base';
import { Spinner } from '../ui';
import { MILESTONE_STATUS } from '../../common/types';

export class InitCommand extends BaseCommand {
  register(program: Command): void {
    program
      .command('init')
      .description('Generate tasks.md from a PRD file')
      .option('--dir <path>', 'Directory containing the PRD file', '.')
      .option('--prd <filename>', 'Name of the PRD file', 'PRD.md')
      .option('--force', 'Overwrite existing tasks.md')
      .action(async (options) => {
        await this.execute(options);
      });
  }

  async execute(options: any): Promise<void> {
    const spinner = new Spinner('Connecting to daemon...');
    spinner.start();
    try {
      const dir = path.resolve(options.dir);
      const { CONFIG_DIR } = await import('../../common/config');

      const response = await this.context.client.sendCommand('init', {
        dir,
        prd: options.prd,
        force: options.force,
        configDir: CONFIG_DIR
      }, (milestone) => {
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
        spinner.stop(`Failed: ${response.message}`, false);
        if (response.data) {
          console.log('Logs:', response.data);
        }
        return;
      } 
      spinner.stop(response.data || 'Successfully generated tasks.md', true);
      
    } catch (error: any) {
      spinner.stop(`Error: ${error.message}`, false);
    } finally {
      spinner.stop();
    }
  }
}
