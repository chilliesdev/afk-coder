import { Command } from 'commander';
import { RemoveCommand } from '../../../../src/cli/commands/remove';
import { DaemonClient } from '../../../../src/cli/client';
import { Spinner } from '../../../../src/cli/ui';
import { MILESTONE_STATUS, MILESTONE_TYPE } from '../../../../src/common/types';
import { GitClient } from '../../../../src/common/git';
import * as readline from 'node:readline';

// Mock Spinner
jest.mock('../../../../src/cli/ui');

// Mock readline
jest.mock('node:readline');

describe('RemoveCommand', () => {
  let mockSendCommand: jest.Mock;
  let mockRemoveSafeDirectory: jest.Mock;
  let mockGitClient: any;
  let mockContext: any;
  let mockSpinner: any;
  let mockQuestion: jest.Mock;
  let mockClose: jest.Mock;
  let mockReadlineInterface: any;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockSendCommand = jest.fn();
    mockRemoveSafeDirectory = jest.fn();
    mockGitClient = {
      removeSafeDirectory: mockRemoveSafeDirectory,
    };

    mockContext = {
      client: {
        sendCommand: mockSendCommand,
      } as unknown as DaemonClient,
      validator: {},
      gitClientFactory: (dir: string) => mockGitClient as GitClient,
    };

    mockSpinner = {
      start: jest.fn(),
      update: jest.fn(),
      stop: jest.fn(),
    };
    (Spinner as jest.Mock).mockImplementation(() => mockSpinner);

    mockQuestion = jest.fn();
    mockClose = jest.fn();
    mockReadlineInterface = {
      question: mockQuestion,
      close: mockClose,
    };
    (readline.createInterface as jest.Mock).mockReturnValue(mockReadlineInterface);

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should register the remove command', () => {
    const program = new Command();
    const command = new RemoveCommand(mockContext);
    
    const commandSpy = jest.spyOn(program, 'command');
    command.register(program);
    expect(commandSpy).toHaveBeenCalledWith('remove <workflow_name>');
  });

  it('should remove a finished workflow successfully', async () => {
    mockSendCommand.mockImplementation(async (cmd, args, onMilestone) => {
      if (cmd === 'status') {
        return { success: true, data: { name: 'wf-test', isWorktree: false, dir: '/path/to/wf' } };
      }
      if (cmd === 'remove') {
        if (onMilestone) {
          onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting...' });
          onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.INFO, message: 'Deleting files...' });
          onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.COMPLETED, message: 'Success' });
        }
        return { success: true };
      }
      return { success: false };
    });

    const command = new RemoveCommand(mockContext);
    await command.execute('wf-test', {});

    expect(mockSpinner.start).toHaveBeenCalled();
    expect(mockSpinner.start).toHaveBeenCalledWith('Starting...');
    expect(mockSpinner.update).toHaveBeenCalledWith('Deleting files...');
    expect(mockSpinner.stop).toHaveBeenCalledWith('Success', true);
    expect(mockSpinner.stop).toHaveBeenCalledWith('Workflow wf-test removed.', true);
  });

  it('should remove worktree and clean git safe directory', async () => {
    mockSendCommand.mockImplementation(async (cmd, args) => {
      if (cmd === 'status') {
        return { success: true, data: { name: 'wf-test', isWorktree: true, dir: '/path/to/wf' } };
      }
      if (cmd === 'remove') {
        return { success: true, data: { name: 'wf-test', isWorktree: true, dir: '/path/to/wf' } };
      }
      return { success: false };
    });

    const command = new RemoveCommand(mockContext);
    await command.execute('wf-test', {});

    expect(mockRemoveSafeDirectory).toHaveBeenCalledWith('/path/to/wf');
    expect(mockSpinner.stop).toHaveBeenCalledWith('Workflow wf-test removed.', true);
  });

  it('should prompt user before deleting non-worktree directory', async () => {
    mockSendCommand.mockResolvedValueOnce({ success: true, data: { name: 'wf-test', isWorktree: false, dir: '/path/to/wf' } });
    mockSendCommand.mockResolvedValueOnce({ success: true });
    
    mockQuestion.mockImplementation((q, callback) => {
      callback('y');
    });

    const command = new RemoveCommand(mockContext);
    await command.execute('wf-test', { deleteDir: true });

    expect(mockQuestion).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
    expect(mockSendCommand).toHaveBeenLastCalledWith('remove', { name: 'wf-test', deleteDir: true }, expect.any(Function));
  });

  it('should abort standard directory delete if user says no', async () => {
    mockSendCommand.mockResolvedValueOnce({ success: true, data: { name: 'wf-test', isWorktree: false, dir: '/path/to/wf' } });
    
    mockQuestion.mockImplementation((q, callback) => {
      callback('n');
    });

    const command = new RemoveCommand(mockContext);
    await command.execute('wf-test', { deleteDir: true });

    expect(mockQuestion).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('Aborted.');
    expect(mockSendCommand).toHaveBeenCalledTimes(1); // Only status query
  });

  it('should handle failure of status fetch', async () => {
    mockSendCommand.mockResolvedValueOnce({ success: false, message: 'Workflow not found' });

    const command = new RemoveCommand(mockContext);
    await command.execute('wf-test', {});

    expect(mockSpinner.stop).toHaveBeenCalledWith('Failed to remove workflow: Workflow not found', false);
  });

  it('should handle failure of remove command', async () => {
    mockSendCommand.mockResolvedValueOnce({ success: true, data: { name: 'wf-test', isWorktree: false, dir: '/path/to/wf' } });
    mockSendCommand.mockResolvedValueOnce({ success: false, message: 'Cannot remove running workflow' });

    const command = new RemoveCommand(mockContext);
    await command.execute('wf-test', {});

    expect(mockSpinner.stop).toHaveBeenCalledWith('Failed to remove workflow: Cannot remove running workflow', false);
  });

  it('should handle milestone failures', async () => {
    mockSendCommand.mockImplementation(async (cmd, args, onMilestone) => {
      if (cmd === 'status') return { success: true, data: { name: 'wf-test' } };
      if (cmd === 'remove' && onMilestone) {
        onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.FAILED, message: 'Fatal removal failure' });
      }
      return { success: false, message: 'Failed' };
    });

    const command = new RemoveCommand(mockContext);
    await command.execute('wf-test', {});

    expect(mockSpinner.stop).toHaveBeenCalledWith('Fatal removal failure', false);
  });

  it('should handle general exception errors', async () => {
    mockSendCommand.mockRejectedValue(new Error('Network disconnected'));

    const command = new RemoveCommand(mockContext);
    await command.execute('wf-test', {});

    expect(mockSpinner.stop).toHaveBeenCalledWith('Error: Network disconnected', false);
  });

  it('should instantiate ShellGitClient if gitClientFactory is not provided', async () => {
    const contextNoGitFactory = {
      client: {
        sendCommand: mockSendCommand,
      } as unknown as DaemonClient,
      validator: {} as any,
    };
    mockSendCommand.mockImplementation(async (cmd, args) => {
      if (cmd === 'status') return { success: true, data: { name: 'wf-test', isWorktree: true, dir: '/path/to/wf' } };
      if (cmd === 'remove') return { success: true, data: { name: 'wf-test', isWorktree: true, dir: '/path/to/wf' } };
      return { success: false };
    });

    const command = new RemoveCommand(contextNoGitFactory);
    await command.execute('wf-test', {});
    // Should run to the end without failing because getGitClient handles errors or ignores them
    expect(mockSpinner.stop).toHaveBeenCalledWith('Workflow wf-test removed.', true);
  });
});
