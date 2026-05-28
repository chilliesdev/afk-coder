import { Command } from 'commander';
import { BaseCommand } from './base';

export class KillCommand extends BaseCommand {
  register(program: Command): void {
    program
      .command('kill <workflow_name>')
      .description('Terminate a workflow')
      .action(async (workflowName) => {
        try {
          const response = await this.context.client.sendCommand('kill', { name: workflowName });
          if (!response.success) {
            console.error(`Failed to kill workflow: ${response.message}`);
            return;
          }
          console.log(`Workflow ${workflowName} killed.`);
        } catch (error: any) {
          console.error(error.message);
        }
      });
  }
}
