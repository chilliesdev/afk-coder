import { Command } from 'commander';
import { BaseCommand } from './base';
import * as fs from 'node:fs';

export class ConfigCommand extends BaseCommand {
  register(program: Command): void {
    const configCmd = program.command('config').description('Manage configuration');

    configCmd
      .command('show')
      .description('Print the current configuration')
      .action(async () => {
        const { ConfigManager } = await import('../../common/config');
        const configManager = new ConfigManager();
        const config = configManager.loadConfig();
        console.log(JSON.stringify(config, null, 2));
      });

    configCmd
      .command('get <key>')
      .description('Get a configuration value (supports dot-notation for nested keys)')
      .action(async (key) => {
        const { ConfigManager } = await import('../../common/config');
        const configManager = new ConfigManager();
        const config = configManager.loadConfig();

        const parts = key.split('.');
        let val: any = config;
        for (const part of parts) {
          if (val && typeof val === 'object' && part in val) {
            val = val[part];
          } else {
            console.error(`Error: Configuration key "${key}" not found.`);
            process.exit(1);
          }
        }

        if (typeof val === 'object' && val !== null) {
          console.log(JSON.stringify(val, null, 2));
        } else {
          console.log(val);
        }
      });

    configCmd
      .command('set <key> <value>')
      .description('Set a configuration value (supports dot-notation and type coercion)')
      .action(async (key, value) => {
        const { ConfigManager } = await import('../../common/config');
        const configManager = new ConfigManager();
        const config = configManager.loadConfig();

        let coercedValue: any = value;
        if (value.toLowerCase() === 'true') coercedValue = true;
        else if (value.toLowerCase() === 'false') coercedValue = false;
        else if (value.toLowerCase() === 'null') coercedValue = null;
        else if (!Number.isNaN(Number(value)) && value.trim() !== '') coercedValue = Number(value);
        else if (value.startsWith('[') && value.endsWith(']')) {
          try {
            coercedValue = JSON.parse(value);
          } catch {
            // Fallback to comma-separated string if JSON parse fails
            coercedValue = value.slice(1, -1).split(',').map((s: string) => s.trim());
          }
        } else if (value.includes(',')) {
          coercedValue = value.split(',').map((s: string) => s.trim());
        }

        const parts = key.split('.');
        let current: any = config;
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
            current[part] = {};
          }
          current = current[part];
        }

        const lastPart = parts.at(-1)!;
        
        // Validation for specific keys
        if ((key === 'sandbox.memory' || key === 'sandbox.nanoCpus') && (typeof coercedValue !== 'number' || Number.isNaN(coercedValue))) {
          console.error(`Error: ${key} must be a number.`);
          process.exit(1);
        }

        if (key === 'daemon.logLevel') {
          const allowedLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
          const valStr = String(coercedValue).toLowerCase();
          if (!allowedLevels.includes(valStr)) {
            console.error(`Error: daemon.logLevel must be one of: ${allowedLevels.join(', ')}`);
            process.exit(1);
          }
          coercedValue = valStr;
        }

        if (key === 'auth.scopes') {
          if (Array.isArray(coercedValue)) {
            coercedValue = coercedValue.map(String);
          } else {
            if (coercedValue === null || coercedValue === undefined) {
              coercedValue = [];
            } else if (typeof coercedValue === 'string') {
              coercedValue = coercedValue.split(',').map((s: string) => s.trim()).filter(Boolean);
            } else {
              coercedValue = [String(coercedValue)];
            }
          }
        }

        current[lastPart] = coercedValue;

        configManager.saveConfig(config);
        console.log(`Successfully set "${key}" to:`, coercedValue);
      });

    configCmd
      .command('edit')
      .description('Open the configuration file in your default editor')
      .action(async () => {
        const { ConfigManager, CONFIG_PATH } = await import('../../common/config');
        const { spawnSync } = await import('node:child_process');
        const configManager = new ConfigManager();
        
        // Ensure config exists
        if (!fs.existsSync(CONFIG_PATH)) {
          configManager.saveConfig(configManager.loadConfig());
        }

        const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'nano');
        console.log(`Opening configuration in ${editor}...`);

        const result = spawnSync(editor, [CONFIG_PATH], {
          stdio: 'inherit',
          shell: true
        });

        if (result.status === 0) {
          console.log('Configuration updated.');
        } else {
          console.error(`Editor exited with code ${result.status}`);
        }
      });
  }
}
