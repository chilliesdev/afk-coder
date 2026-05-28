import { Command } from 'commander';
import { ListCommand } from '../../../../src/cli/commands/list';
import { DaemonClient } from '../../../../src/cli/client';

describe('ListCommand', () => {
  let mockSendCommand: jest.Mock;
  let mockContext: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleTableSpy: jest.SpyInstance;

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
    consoleTableSpy = jest.spyOn(console, 'table').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleTableSpy.mockRestore();
  });

  it('should register the list command', () => {
    const program = new Command();
    const command = new ListCommand(mockContext);
    
    const commandSpy = jest.spyOn(program, 'command');
    command.register(program);
    expect(commandSpy).toHaveBeenCalledWith('list');
  });

  it('should print a message when no workflows are active', async () => {
    mockSendCommand.mockResolvedValue({ success: true, data: [] });

    const command = new ListCommand(mockContext);
    await command.execute();

    expect(consoleLogSpy).toHaveBeenCalledWith('No active workflows found. Use "afk start <workflow_name>" to start one.');
    expect(consoleTableSpy).not.toHaveBeenCalled();
  });

  it('should display a table of workflows when active workflows exist', async () => {
    const activeWorkflows = [
      {
        name: 'wf-1',
        status: 'Running',
        progress: '2/5',
        phase: 'Coding',
        qaCycles: 1,
        uptime: 3661000 // 1h 1m 1s
      },
      {
        name: 'wf-2',
        status: 'Pending',
        progress: '0/10',
        uptime: 59000 // 59s
      }
    ];
    mockSendCommand.mockResolvedValue({ success: true, data: activeWorkflows });

    const command = new ListCommand(mockContext);
    await command.execute();

    expect(consoleTableSpy).toHaveBeenCalledWith([
      {
        name: 'wf-1',
        status: 'Running',
        progress: '2/5',
        phase: 'Coding',
        'QA Cycles': '1/3',
        uptime: '1h 1m 1s'
      },
      {
        name: 'wf-2',
        status: 'Pending',
        progress: '0/10',
        phase: 'Coding',
        'QA Cycles': '0/3',
        uptime: '59s'
      }
    ]);
  });

  it('should handle failure to list workflows from daemon', async () => {
    mockSendCommand.mockResolvedValue({ success: false, message: 'Daemon internal error' });

    const command = new ListCommand(mockContext);
    await command.execute();

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to list workflows: Daemon internal error');
  });

  it('should handle exceptions during command execution', async () => {
    mockSendCommand.mockRejectedValue(new Error('Connection failure'));

    const command = new ListCommand(mockContext);
    await command.execute();

    expect(consoleErrorSpy).toHaveBeenCalledWith('Connection failure');
  });

  it('should call execute when command is parsed by Commander', async () => {
    mockSendCommand.mockResolvedValue({ success: true, data: [] });
    const program = new Command();
    const command = new ListCommand(mockContext);
    command.register(program);

    await program.parseAsync(['node', 'test', 'list']);
    expect(mockSendCommand).toHaveBeenCalledWith('list');
  });
});
