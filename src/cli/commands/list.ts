import { Command } from 'commander';
import { BaseCommand } from './base';

export class ListCommand extends BaseCommand {
  register(program: Command): void {
    program
      .command('list')
      .description('List running workflows')
      .action(async () => {
        await this.execute();
      });
  }

  async execute(): Promise<void> {
    try {
      const response = await this.context.client.sendCommand('list');
      if (!response.success) {
        console.error(`Failed to list workflows: ${response.message}`);
        return;
      }

      if (!response.data || response.data.length === 0) {
        console.log('No active workflows found. Use "afk start <workflow_name>" to start one.');
        return;
      }
      
      const formattedData = response.data.map((w: any) => {
        const s = Math.floor(w.uptime / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const rs = s % 60;
        return {
          name: w.name,
          status: w.status,
          progress: w.progress,
          phase: w.phase || 'Coding',
          'QA Cycles': w.qaCycles === undefined ? '0/3' : `${w.qaCycles}/3`,
          uptime: `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${rs}s`,
        };
      });
      console.table(formattedData);
    } catch (error: any) {
      console.error(error.message);
    }
  }
}
