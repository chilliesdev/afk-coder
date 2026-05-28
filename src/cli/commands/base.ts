import { Command } from 'commander';
import { DaemonClient } from '../client';
import { TaskValidator } from '../../common/validation';

export interface CommandContext {
  client: DaemonClient;
  validator: TaskValidator;
}

export abstract class BaseCommand {
  constructor(protected readonly context: CommandContext) {}

  abstract register(program: Command): void;
}
