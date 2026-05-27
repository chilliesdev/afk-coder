const mockSendCommand = jest.fn();

// Mock DaemonClient
jest.mock('../src/cli/client', () => {
  return {
    DaemonClient: jest.fn().mockImplementation(() => {
      return {
        sendCommand: mockSendCommand
      };
    })
  };
});

import { program } from '../src/cli/index';

const mockQuestion = jest.fn();
const mockClose = jest.fn();

// Mock readline
jest.mock('node:readline', () => {
  return {
    createInterface: jest.fn().mockImplementation(() => {
      return {
        question: mockQuestion,
        close: mockClose
      };
    })
  };
});

describe('afk remove command integration', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
  });

  const runCommand = async (args: string[]) => {
    await program.parseAsync(['node', 'afk', ...args]);
  };

  it('should remove a workflow successfully by default (without deleting directory)', async () => {
    // Mock status response
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      data: { name: 'test-wf', isWorktree: true, dir: '/some/dir' }
    });
    // Mock remove response
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      data: { isWorktree: true, dir: '/some/dir' }
    });

    await runCommand(['remove', 'test-wf']);

    // Check status query
    expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'status', { name: 'test-wf' });
    // Check remove command without deleteDir (defaults to false)
    expect(mockSendCommand).toHaveBeenNthCalledWith(2, 'remove', { name: 'test-wf', deleteDir: false }, expect.any(Function));
  });

  it('should remove a worktree workflow and delete directory when --delete-dir is specified without prompting', async () => {
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      data: { name: 'test-wf-wt', isWorktree: true, dir: '/some/dir-wt' }
    });
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      data: { isWorktree: true, dir: '/some/dir-wt' }
    });

    await runCommand(['remove', 'test-wf-wt', '--delete-dir']);

    expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'status', { name: 'test-wf-wt' });
    // Should NOT prompt for confirmation for worktree workflow
    expect(mockQuestion).not.toHaveBeenCalled();
    expect(mockSendCommand).toHaveBeenNthCalledWith(2, 'remove', { name: 'test-wf-wt', deleteDir: true }, expect.any(Function));
  });

  it('should prompt for confirmation on non-worktree workflow when --delete-dir is specified and proceed on yes', async () => {
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      data: { name: 'test-wf-normal', isWorktree: false, dir: '/some/dir-normal' }
    });
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      data: { isWorktree: false, dir: '/some/dir-normal' }
    });

    // Simulate user typing 'y'
    mockQuestion.mockImplementationOnce((promptText, callback) => {
      callback('y');
    });

    await runCommand(['remove', 'test-wf-normal', '--delete-dir']);

    expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'status', { name: 'test-wf-normal' });
    expect(mockQuestion).toHaveBeenCalledWith(
      expect.stringContaining('Are you sure you want to delete the directory "/some/dir-normal"?'),
      expect.any(Function)
    );
    expect(mockSendCommand).toHaveBeenNthCalledWith(2, 'remove', { name: 'test-wf-normal', deleteDir: true }, expect.any(Function));
  });

  it('should prompt for confirmation on non-worktree workflow when --delete-dir is specified and abort on no', async () => {
    mockSendCommand.mockResolvedValueOnce({
      success: true,
      data: { name: 'test-wf-normal', isWorktree: false, dir: '/some/dir-normal' }
    });

    // Simulate user typing 'n'
    mockQuestion.mockImplementationOnce((promptText, callback) => {
      callback('n');
    });

    await runCommand(['remove', 'test-wf-normal', '--delete-dir']);

    expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'status', { name: 'test-wf-normal' });
    expect(mockQuestion).toHaveBeenCalled();
    // Should abort and NOT call remove
    expect(mockSendCommand).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('Aborted.');
  });
});
