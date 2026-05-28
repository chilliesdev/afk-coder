import { Command } from 'commander';
import { DaemonClient } from '../client';
import { TaskValidator } from '../../common/validation';
import { GitClient } from '../../common/git';

export interface CommandContext {
  client: DaemonClient;
  validator: TaskValidator;
  gitClientFactory?: (dir: string) => GitClient;
}

export abstract class BaseCommand {
  constructor(protected readonly context: CommandContext) {}

  abstract register(program: Command): void;
}
