import { Command } from 'commander';
import { StatusCommand } from '../../../../src/cli/commands/status';
import { DaemonClient } from '../../../../src/cli/client';

describe('StatusCommand', () => {
  let mockSendCommand: jest.Mock;
  let mockContext: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let originalStdoutIsTTY: any;

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
    originalStdoutIsTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.stdout.isTTY = originalStdoutIsTTY;
  });

  it('should register the status command', () => {
    const program = new Command();
    const command = new StatusCommand(mockContext);
    
    const commandSpy = jest.spyOn(program, 'command');
    command.register(program);
    expect(commandSpy).toHaveBeenCalledWith('status <workflow_name>');
  });

  it('should show detailed status of a workflow without color', async () => {
    const mockWorkflowData = {
      name: 'wf-status',
      status: 'Done',
      pid: 12345,
      uptime: 3661000,
      dir: '/some/dir',
      progress: '5/5',
      phase: 'QA',
      qaCycles: 2,
      currentTask: 'Task finished successfully',
      recentTasks: ['Task A', 'Task B'],
      tokenUsage: {
        input: 15000,
        output: 3000,
        total: 18000
      }
    };
    mockSendCommand.mockResolvedValue({ success: true, data: mockWorkflowData });

    const command = new StatusCommand(mockContext);
    await command.execute('wf-status', { color: false });

    expect(consoleLogSpy).toHaveBeenCalledWith('Workflow: wf-status');
    expect(consoleLogSpy).toHaveBeenCalledWith('Status:    Done');
    expect(consoleLogSpy).toHaveBeenCalledWith('PID:       12345');
    expect(consoleLogSpy).toHaveBeenCalledWith('Uptime:    1h 1m 1s');
    expect(consoleLogSpy).toHaveBeenCalledWith('Directory: /some/dir');
    expect(consoleLogSpy).toHaveBeenCalledWith('Progress:  5/5');
    expect(consoleLogSpy).toHaveBeenCalledWith('Phase:     QA');
    expect(consoleLogSpy).toHaveBeenCalledWith('QA Cycle:  2/3');
    expect(consoleLogSpy).toHaveBeenCalledWith('  Task finished successfully');
    expect(consoleLogSpy).toHaveBeenCalledWith('  - Task A');
    expect(consoleLogSpy).toHaveBeenCalledWith('  - Task B');
    expect(consoleLogSpy).toHaveBeenCalledWith('  Input:  15,000');
    expect(consoleLogSpy).toHaveBeenCalledWith('  Output: 3,000');
    expect(consoleLogSpy).toHaveBeenCalledWith('  Total:  18,000');
  });

  it('should handle None currentTask and empty recentTasks', async () => {
    const mockWorkflowData = {
      name: 'wf-status',
      status: 'Running: task',
      pid: undefined,
      uptime: 5000,
      dir: '/some/dir',
      progress: '0/5',
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0
      }
    };
    mockSendCommand.mockResolvedValue({ success: true, data: mockWorkflowData });

    const command = new StatusCommand(mockContext);
    await command.execute('wf-status', { color: false });

    expect(consoleLogSpy).toHaveBeenCalledWith('PID:       N/A');
    expect(consoleLogSpy).toHaveBeenCalledWith('Phase:     Coding');
    expect(consoleLogSpy).toHaveBeenCalledWith('QA Cycle:  0/3');
    expect(consoleLogSpy).toHaveBeenCalledWith('  None');
  });

  it('should format status with colors when useColor is true', async () => {
    process.stdout.isTTY = true;
    const mockWorkflowData = {
      name: 'wf-color',
      status: 'Running: test',
      uptime: 5000,
      dir: '/some/dir',
      progress: '0/5',
      tokenUsage: { input: 0, output: 0, total: 0 }
    };
    mockSendCommand.mockResolvedValue({ success: true, data: mockWorkflowData });

    const command = new StatusCommand(mockContext);
    await command.execute('wf-color', { color: true });

    // The Workflow title should contain ANSI colors if useColor is true
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('\u001B[1mWorkflow:'));
  });

  it('should format status with red color for failed workflows', async () => {
    process.stdout.isTTY = true;
    const mockWorkflowData = {
      name: 'wf-failed',
      status: 'Failed: bug',
      uptime: 5000,
      dir: '/some/dir',
      progress: '0/5',
      tokenUsage: { input: 0, output: 0, total: 0 }
    };
    mockSendCommand.mockResolvedValue({ success: true, data: mockWorkflowData });

    const command = new StatusCommand(mockContext);
    await command.execute('wf-failed', { color: true });

    // The status should contain red color sequence (\u001B[31m)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('\u001B[31mFailed: bug'));
  });

  it('should format status with red color for killed workflows', async () => {
    process.stdout.isTTY = true;
    const mockWorkflowData = {
      name: 'wf-killed',
      status: 'Killed',
      uptime: 5000,
      dir: '/some/dir',
      progress: '0/5',
      tokenUsage: { input: 0, output: 0, total: 0 }
    };
    mockSendCommand.mockResolvedValue({ success: true, data: mockWorkflowData });

    const command = new StatusCommand(mockContext);
    await command.execute('wf-killed', { color: true });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('\u001B[31mKilled'));
  });

  it('should handle failure message from daemon', async () => {
    mockSendCommand.mockResolvedValue({ success: false, message: 'Workflow not found' });

    const command = new StatusCommand(mockContext);
    await command.execute('wf-status', { color: false });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to get status: Workflow not found');
  });

  it('should handle exceptions during status query', async () => {
    mockSendCommand.mockRejectedValue(new Error('Network error'));

    const command = new StatusCommand(mockContext);
    await command.execute('wf-status', { color: false });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Network error');
  });

  it('should call execute when command is parsed by Commander', async () => {
    mockSendCommand.mockResolvedValue({ success: true, data: { name: 'wf-status', status: 'Running', uptime: 1000, dir: '/dir', progress: '0/0', tokenUsage: { input: 0, output: 0, total: 0 } } });
    const program = new Command();
    const command = new StatusCommand(mockContext);
    command.register(program);

    await program.parseAsync(['node', 'test', 'status', 'wf-status']);
    expect(mockSendCommand).toHaveBeenCalledWith('status', { name: 'wf-status' });
  });
});
