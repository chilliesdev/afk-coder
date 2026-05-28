import { Command } from 'commander';
import { KillCommand } from '../../../../src/cli/commands/kill';
import { DaemonClient } from '../../../../src/cli/client';

describe('KillCommand', () => {
  let mockSendCommand: jest.Mock;
  let mockContext: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendCommand = jest.fn();
    mockContext = {
      client: {
        sendCommand: mockSendCommand,
      } as unknown as DaemonClient,
      validator: {},
    };
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should register the kill command', () => {
    const program = new Command();
    const command = new KillCommand(mockContext);
    
    const commandSpy = jest.spyOn(program, 'command');
    command.register(program);
    expect(commandSpy).toHaveBeenCalledWith('kill <workflow_name>');
  });

  it('should kill workflow successfully', async () => {
    mockSendCommand.mockResolvedValue({ success: true });
    
    const command = new KillCommand(mockContext);
    await command.execute('test-wf');

    expect(mockSendCommand).toHaveBeenCalledWith('kill', { name: 'test-wf' });
    expect(consoleLogSpy).toHaveBeenCalledWith('Workflow test-wf killed.');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('should handle failure from daemon', async () => {
    mockSendCommand.mockResolvedValue({ success: false, message: 'Workflow not found' });

    const command = new KillCommand(mockContext);
    await command.execute('test-wf');

    expect(mockSendCommand).toHaveBeenCalledWith('kill', { name: 'test-wf' });
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to kill workflow: Workflow not found');
  });

  it('should handle errors thrown during command execution', async () => {
    mockSendCommand.mockRejectedValue(new Error('Connection timed out'));

    const command = new KillCommand(mockContext);
    await command.execute('test-wf');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Connection timed out');
  });

  it('should call execute when command is parsed by Commander', async () => {
    mockSendCommand.mockResolvedValue({ success: true });
    const program = new Command();
    const command = new KillCommand(mockContext);
    command.register(program);

    await program.parseAsync(['node', 'test', 'kill', 'test-wf']);
    expect(mockSendCommand).toHaveBeenCalledWith('kill', { name: 'test-wf' });
  });
});
