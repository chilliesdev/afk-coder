import { Command } from 'commander';
import { BaseCommand } from './base';
import { LogFormatter } from '../log-formatter';

export class LogsCommand extends BaseCommand {
  register(program: Command): void {
    program
      .command('logs [workflow_name]')
      .description('View workflow logs')
      .option('-f, --follow', 'Stream logs')
      .option('--tail <lines>', 'Number of lines to show')
      .option('--json', 'Show logs in raw JSON format')
      .option('--raw', 'Show logs as they are stored (no formatting)')
      .option('--no-color', 'Disable color output')
      .option('--daemon', 'Show daemon logs')
      .action(async (workflowName, options) => {
        await this.execute(workflowName, options);
      });
  }

  async execute(workflowName: string | undefined, options: any): Promise<void> {
    try {
      if (workflowName && options.daemon) {
        console.error('Error: Cannot specify both a workflow name and --daemon');
        return;
      }

      const formatter = new LogFormatter({
        color: options.color !== false,
        json: options.json,
        raw: options.raw
      });

      const printFormattedLogs = (content: string) => {
        if (!content) return;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (i === lines.length - 1 && !line) break;
          process.stdout.write(formatter.format(line, options) + '\n');
        }
      };

      if (options.follow) {
        if (options.daemon) {
          console.log('Following daemon logs... (Ctrl+C to stop)');
        } else if (workflowName) {
          console.log(`Following logs for ${workflowName}... (Ctrl+C to stop)`);
        } else {
          console.log('Following logs for all workflows... (Ctrl+C to stop)');
        }
        const response = await this.context.client.sendCommand(
          'logs',
          {
            name: workflowName,
            tail: options.tail || 20,
            follow: true,
            daemon: options.daemon
          },
          undefined,
          (logLine) => {
            printFormattedLogs(logLine);
          }
        );
        if (!response.success) {
          console.error(`Failed to stream logs: ${response.message}`);
        }
      } else {
        const response = await this.context.client.sendCommand('logs', { name: workflowName, tail: options.tail, daemon: options.daemon });
        if (!response.success) {
          console.error(`Failed to get logs: ${response.message}`);
          return;
        }
        printFormattedLogs(response.data.content);
      }
    } catch (error: any) {
      console.error(error.message);
    }
  }
}
