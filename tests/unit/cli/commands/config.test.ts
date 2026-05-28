import { Command } from 'commander';
import { ConfigCommand } from '../../../../src/cli/commands/config';
import { DaemonClient } from '../../../../src/cli/client';
import { ConfigManager } from '../../../../src/common/config';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// Mock ConfigManager
jest.mock('../../../../src/common/config');

// Mock fs
jest.mock('node:fs');

// Mock child_process spawnSync
jest.mock('node:child_process', () => ({
  spawnSync: jest.fn()
}));

describe('ConfigCommand', () => {
  let mockContext: any;
  let mockConfigManagerInstance: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContext = {
      client: {} as unknown as DaemonClient,
      validator: {},
    };

    mockConfigManagerInstance = {
      loadConfig: jest.fn().mockReturnValue({
        sandbox: {
          image: 'test-image',
          memory: 2147483648,
          nanoCpus: 2000000000
        },
        daemon: {
          logLevel: 'info',
        },
        auth: {
          scopes: ['scope1']
        }
      }),
      saveConfig: jest.fn(),
    };
    (ConfigManager as jest.Mock).mockImplementation(() => mockConfigManagerInstance);

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should register the config command and subcommands', () => {
    const program = new Command();
    const command = new ConfigCommand(mockContext);
    
    // We can just call register and ensure no errors are thrown
    command.register(program);
    const configCmd = program.commands.find(c => c.name() === 'config');
    expect(configCmd).toBeDefined();
    expect(configCmd?.commands.map(c => c.name())).toEqual(['show', 'get', 'set', 'edit']);
  });

  it('should execute show', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeShow();

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('test-image'));
  });

  it('should execute get for a normal key', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeGet('sandbox.image');

    expect(consoleLogSpy).toHaveBeenCalledWith('test-image');
  });

  it('should execute get for a nested object key', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeGet('sandbox');

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"image": "test-image"'));
  });

  it('should throw error for non-existent keys in get', async () => {
    const command = new ConfigCommand(mockContext);
    await expect(command.executeGet('sandbox.nonexistent')).rejects.toThrow(
      'Error: Configuration key "sandbox.nonexistent" not found.'
    );
  });

  it('should execute set and coerce boolean types', async () => {
    const command = new ConfigCommand(mockContext);
    
    await command.executeSet('sandbox.privileged', 'true');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      sandbox: expect.objectContaining({
        privileged: true
      })
    }));

    await command.executeSet('sandbox.privileged', 'false');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      sandbox: expect.objectContaining({
        privileged: false
      })
    }));
  });

  it('should execute set and coerce null values', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeSet('sandbox.customKey', 'null');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      sandbox: expect.objectContaining({
        customKey: null
      })
    }));
  });

  it('should execute set and coerce number values', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeSet('sandbox.memory', '4194304');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      sandbox: expect.objectContaining({
        memory: 4194304
      })
    }));
  });

  it('should execute set and coerce JSON array values', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeSet('auth.scopes', '["a", "b"]');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        scopes: ['a', 'b']
      })
    }));
  });

  it('should execute set and fallback to comma-split for invalid JSON arrays', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeSet('auth.scopes', '[a, b]');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        scopes: ['a', 'b']
      })
    }));
  });

  it('should execute set and split CSV values', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeSet('auth.scopes', 'scopeA,scopeB');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        scopes: ['scopeA', 'scopeB']
      })
    }));
  });

  it('should handle set on nested path that does not exist', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeSet('newGroup.nestedKey', 'value');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      newGroup: {
        nestedKey: 'value'
      }
    }));
  });

  it('should validate sandbox memory key to be number', async () => {
    const command = new ConfigCommand(mockContext);
    await expect(command.executeSet('sandbox.memory', 'not-a-number')).rejects.toThrow(
      'Error: sandbox.memory must be a number.'
    );
  });

  it('should validate sandbox nanoCpus key to be number', async () => {
    const command = new ConfigCommand(mockContext);
    await expect(command.executeSet('sandbox.nanoCpus', 'not-a-number')).rejects.toThrow(
      'Error: sandbox.nanoCpus must be a number.'
    );
  });

  it('should validate daemon.logLevel values', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeSet('daemon.logLevel', 'DEBUG'); // Case-insensitivity
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      daemon: expect.objectContaining({
        logLevel: 'debug'
      })
    }));

    await expect(command.executeSet('daemon.logLevel', 'invalid-log-level')).rejects.toThrow(
      'Error: daemon.logLevel must be one of: error, warn, info, http, verbose, debug, silly'
    );
  });

  it('should coerce auth.scopes properly when a single non-array string is passed', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeSet('auth.scopes', 'single-scope');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        scopes: ['single-scope']
      })
    }));
  });

  it('should coerce auth.scopes to empty array when null is passed', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeSet('auth.scopes', 'null');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        scopes: []
      })
    }));
  });

  it('should execute edit and call editor via spawnSync', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (spawnSync as jest.Mock).mockReturnValue({ status: 0 });

    const command = new ConfigCommand(mockContext);
    await command.executeEdit();

    expect(spawnSync).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('Configuration updated.');
  });

  it('should execute edit and create config file if missing', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (spawnSync as jest.Mock).mockReturnValue({ status: 0 });

    const command = new ConfigCommand(mockContext);
    await command.executeEdit();

    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalled();
    expect(spawnSync).toHaveBeenCalled();
  });

  it('should throw error if editor exits with non-zero code in edit', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (spawnSync as jest.Mock).mockReturnValue({ status: 1 });

    const command = new ConfigCommand(mockContext);
    await expect(command.executeEdit()).rejects.toThrow(
      'Editor exited with code 1'
    );
  });

  it('should coerce auth.scopes to array of strings when a number is passed', async () => {
    const command = new ConfigCommand(mockContext);
    await command.executeSet('auth.scopes', '123');
    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        scopes: ['123']
      })
    }));
  });

  describe('Commander Action wrappers', () => {
    let processExitSpy: jest.SpyInstance;

    beforeEach(() => {
      processExitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: any) => {
        throw new Error(`Process exited with code ${code}`);
      });
    });

    afterEach(() => {
      processExitSpy.mockRestore();
    });

    it('should handle config show successfully via Commander parse', async () => {
      const program = new Command();
      const command = new ConfigCommand(mockContext);
      command.register(program);

      await program.parseAsync(['node', 'test', 'config', 'show']);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('test-image'));
    });

    it('should handle config show errors gracefully', async () => {
      const program = new Command();
      const command = new ConfigCommand(mockContext);
      command.register(program);

      jest.spyOn(command, 'executeShow').mockRejectedValueOnce(new Error('Show failed'));

      await expect(program.parseAsync(['node', 'test', 'config', 'show'])).rejects.toThrow('Process exited with code 1');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Show failed');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle config get successfully via Commander parse', async () => {
      const program = new Command();
      const command = new ConfigCommand(mockContext);
      command.register(program);

      await program.parseAsync(['node', 'test', 'config', 'get', 'sandbox.image']);
      expect(consoleLogSpy).toHaveBeenCalledWith('test-image');
    });

    it('should handle config get errors gracefully', async () => {
      const program = new Command();
      const command = new ConfigCommand(mockContext);
      command.register(program);

      await expect(program.parseAsync(['node', 'test', 'config', 'get', 'sandbox.nonexistent'])).rejects.toThrow('Process exited with code 1');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Configuration key "sandbox.nonexistent" not found.');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle config set successfully via Commander parse', async () => {
      const program = new Command();
      const command = new ConfigCommand(mockContext);
      command.register(program);

      await program.parseAsync(['node', 'test', 'config', 'set', 'sandbox.memory', '1024']);
      expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalled();
    });

    it('should handle config set errors gracefully', async () => {
      const program = new Command();
      const command = new ConfigCommand(mockContext);
      command.register(program);

      jest.spyOn(command, 'executeSet').mockRejectedValueOnce(new Error('Set failed'));

      await expect(program.parseAsync(['node', 'test', 'config', 'set', 'sandbox.memory', '1024'])).rejects.toThrow('Process exited with code 1');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Set failed');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle config edit errors gracefully', async () => {
      const program = new Command();
      const command = new ConfigCommand(mockContext);
      command.register(program);

      jest.spyOn(command, 'executeEdit').mockRejectedValueOnce(new Error('Edit failed'));

      await expect(program.parseAsync(['node', 'test', 'config', 'edit'])).rejects.toThrow('Process exited with code 1');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Edit failed');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
