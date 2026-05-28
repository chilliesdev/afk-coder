import { Command } from 'commander';
import { BaseCommand } from './base';

export class StatusCommand extends BaseCommand {
  register(program: Command): void {
    program
      .command('status <workflow_name>')
      .description('Show detailed status of a workflow')
      .option('--no-color', 'Disable color output')
      .action(async (workflowName, options) => {
        try {
          const response = await this.context.client.sendCommand('status', { name: workflowName });
          if (!response.success) {
            console.error(`Failed to get status: ${response.message}`);
            return;
          }

          const w = response.data;
          const s = Math.floor(w.uptime / 1000);
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          const rs = s % 60;
          const uptimeStr = `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${rs}s`;

          const useColor = options.color !== false && process.stdout.isTTY;

          const colors = {
            reset: useColor ? '\u001B[0m' : '',
            bold: useColor ? '\u001B[1m' : '',
            green: useColor ? '\u001B[32m' : '',
            yellow: useColor ? '\u001B[33m' : '',
            red: useColor ? '\u001B[31m' : '',
            cyan: useColor ? '\u001B[36m' : '',
          };

          let statusColor = colors.reset;
          if (w.status === 'Done') statusColor = colors.green;
          else if (w.status.startsWith('Running')) statusColor = colors.yellow;
          else if (w.status.startsWith('Failed') || w.status === 'Killed') statusColor = colors.red;

          console.log(`${colors.bold}Workflow:${colors.reset} ${colors.cyan}${w.name}${colors.reset}`);
          console.log('----------------------------------------');
          console.log(`${colors.bold}Status:${colors.reset}    ${statusColor}${w.status}${colors.reset}`);
          console.log(`${colors.bold}PID:${colors.reset}       ${w.pid || 'N/A'}`);
          console.log(`${colors.bold}Uptime:${colors.reset}    ${uptimeStr}`);
          console.log(`${colors.bold}Directory:${colors.reset} ${w.dir}`);
          console.log(`${colors.bold}Progress:${colors.reset}  ${w.progress}`);
          console.log(`${colors.bold}Phase:${colors.reset}     ${w.phase || 'Coding'}`);
          console.log(`${colors.bold}QA Cycle:${colors.reset}  ${w.qaCycles === undefined ? 0 : w.qaCycles}/3`);
          console.log('');
          console.log(`${colors.bold}Current Task:${colors.reset}`);
          console.log(`  ${w.currentTask || 'None'}`);
          console.log('');
          console.log(`${colors.bold}Recent Tasks:${colors.reset}`);
          if (!w.recentTasks || w.recentTasks.length === 0) {
            console.log('  None');
          } else {
            w.recentTasks.forEach((task: string) => console.log(`  - ${task}`));
          }
          console.log('');
          console.log(`${colors.bold}Token Usage:${colors.reset}`);
          console.log(`  Input:  ${w.tokenUsage.input.toLocaleString()}`);
          console.log(`  Output: ${w.tokenUsage.output.toLocaleString()}`);
          console.log(`  Total:  ${w.tokenUsage.total.toLocaleString()}`);
        } catch (error: any) {
          console.error(error.message);
        }
      });
  }
}
