import { Command } from 'commander';
import { LogsCommand } from '../../../../src/cli/commands/logs';
import { DaemonClient } from '../../../../src/cli/client';

describe('LogsCommand', () => {
  let mockSendCommand: jest.Mock;
  let mockContext: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let stdoutWriteSpy: jest.SpyInstance;

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
    stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
  });

  it('should register the logs command', () => {
    const program = new Command();
    const command = new LogsCommand(mockContext);
    const commandSpy = jest.spyOn(program, 'command');

    command.register(program);
    expect(commandSpy).toHaveBeenCalledWith('logs [workflow_name]');
  });

  it('should print error when both workflow name and daemon options are provided', async () => {
    const command = new LogsCommand(mockContext);
    await command.execute('wf-name', { daemon: true });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Cannot specify both a workflow name and --daemon');
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it('should retrieve static logs successfully', async () => {
    mockSendCommand.mockResolvedValue({
      success: true,
      data: { content: 'line 1\nline 2\n' }
    });

    const command = new LogsCommand(mockContext);
    await command.execute('wf-name', {});

    expect(mockSendCommand).toHaveBeenCalledWith('logs', { name: 'wf-name', tail: undefined, daemon: undefined });
    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('line 1\n'));
    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('line 2\n'));
  });

  it('should stream follow logs for daemon', async () => {
    mockSendCommand.mockImplementation(async (cmd, args, onMilestone, onLogLine) => {
      if (onLogLine) {
        onLogLine('daemon line 1\n');
        onLogLine(''); // Empty check
      }
      return { success: true };
    });

    const command = new LogsCommand(mockContext);
    await command.execute(undefined, { follow: true, daemon: true });

    expect(consoleLogSpy).toHaveBeenCalledWith('Following daemon logs... (Ctrl+C to stop)');
    expect(mockSendCommand).toHaveBeenCalledWith(
      'logs',
      { name: undefined, tail: 20, follow: true, daemon: true },
      undefined,
      expect.any(Function)
    );
    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('daemon line 1'));
  });

  it('should stream follow logs for workflow', async () => {
    mockSendCommand.mockResolvedValue({ success: true });

    const command = new LogsCommand(mockContext);
    await command.execute('wf-test', { follow: true });

    expect(consoleLogSpy).toHaveBeenCalledWith('Following logs for wf-test... (Ctrl+C to stop)');
  });

  it('should stream follow logs for all workflows', async () => {
    mockSendCommand.mockResolvedValue({ success: true });

    const command = new LogsCommand(mockContext);
    await command.execute(undefined, { follow: true });

    expect(consoleLogSpy).toHaveBeenCalledWith('Following logs for all workflows... (Ctrl+C to stop)');
  });

  it('should print error when streaming logs fails', async () => {
    mockSendCommand.mockResolvedValue({ success: false, message: 'Stream error' });

    const command = new LogsCommand(mockContext);
    await command.execute('wf-test', { follow: true });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to stream logs: Stream error');
  });

  it('should print error when fetching static logs fails', async () => {
    mockSendCommand.mockResolvedValue({ success: false, message: 'File not found' });

    const command = new LogsCommand(mockContext);
    await command.execute('wf-test', {});

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to get logs: File not found');
  });

  it('should handle general exceptions', async () => {
    mockSendCommand.mockRejectedValue(new Error('IPC disconnected'));

    const command = new LogsCommand(mockContext);
    await command.execute('wf-test', {});

    expect(consoleErrorSpy).toHaveBeenCalledWith('IPC disconnected');
  });
});
