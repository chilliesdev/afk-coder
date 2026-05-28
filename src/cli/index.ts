import { Command } from 'commander';
import { DaemonClient } from './client';
import { TaskValidator } from '../common/validation';
import { registerCleanupHandlers } from './cleanup';
import { InitCommand } from './commands/init';
import { LoginCommand } from './commands/login';
import { StartCommand } from './commands/start';
import { ListCommand } from './commands/list';
import { StatusCommand } from './commands/status';
import { KillCommand } from './commands/kill';
import { RemoveCommand } from './commands/remove';
import { LogsCommand } from './commands/logs';
import { ConfigCommand } from './commands/config';

import { ShellGitClient } from '../common/git';

registerCleanupHandlers();

const client = new DaemonClient();
const validator = new TaskValidator();
const context = { 
  client, 
  validator,
  gitClientFactory: (dir: string) => new ShellGitClient(dir)
};

export const program = new Command();

program
  .name('afk')
  .description('Gemini AFK Coding Daemon CLI')
  .version('1.0.0');

const commands = [
  new InitCommand(context),
  new LoginCommand(context),
  new StartCommand(context),
  new ListCommand(context),
  new StatusCommand(context),
  new KillCommand(context),
  new RemoveCommand(context),
  new LogsCommand(context),
  new ConfigCommand(context),
];

for (const command of commands) {
  command.register(program);
}

if (
  require.main === module ||
  (require.main && require.main.filename.replaceAll('\\', '/').endsWith('bin/afk'))
) {
  program.parse();
}
