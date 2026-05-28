import { Command } from 'commander';
import { StartCommand } from '../../../../src/cli/commands/start';
import { DaemonClient } from '../../../../src/cli/client';
import { GitClient } from '../../../../src/common/git';
import { TaskValidator } from '../../../../src/common/validation';
import * as path from 'node:path';

describe('StartCommand', () => {
  let mockSendCommand: jest.Mock;
  let mockValidateWorkflowDir: jest.Mock;
  let mockGetTopLevel: jest.Mock;
  let mockAddSafeDirectory: jest.Mock;
  let mockGitClient: any;
  let mockContext: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendCommand = jest.fn();
    mockValidateWorkflowDir = jest.fn();
    mockGetTopLevel = jest.fn().mockReturnValue('/mock/repo');
    mockAddSafeDirectory = jest.fn();

    mockGitClient = {
      getTopLevel: mockGetTopLevel,
      addSafeDirectory: mockAddSafeDirectory,
    };

    mockContext = {
      client: {
        sendCommand: mockSendCommand,
      } as unknown as DaemonClient,
      validator: {
        validateWorkflowDir: mockValidateWorkflowDir,
      } as unknown as TaskValidator,
      gitClientFactory: (dir: string) => mockGitClient as GitClient,
    };

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('should register the start command', () => {
    const program = new Command();
    const command = new StartCommand(mockContext);
    
    const commandSpy = jest.spyOn(program, 'command');
    command.register(program);
    expect(commandSpy).toHaveBeenCalledWith('start <workflow_name>');
  });

  it('should start workflow without worktree', async () => {
    mockSendCommand.mockResolvedValue({ success: true });
    
    const command = new StartCommand(mockContext);
    await command.execute('my-wf', { dir: '/test/dir' });

    expect(mockValidateWorkflowDir).toHaveBeenCalledWith('/test/dir');
    expect(mockSendCommand).toHaveBeenCalledWith('start', expect.objectContaining({
      name: 'my-wf',
      dir: '/test/dir',
      isWorktree: undefined
    }));
    expect(consoleLogSpy).toHaveBeenCalledWith('Workflow my-wf started successfully.');
  });

  it('should fail if local validation fails', async () => {
    mockValidateWorkflowDir.mockImplementation(() => {
      throw new Error('Directory contains code changes');
    });

    const command = new StartCommand(mockContext);
    await command.execute('my-wf', { dir: '/test/dir' });

    expect(mockValidateWorkflowDir).toHaveBeenCalledWith('/test/dir');
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Validation failed: Directory contains code changes');
  });

  it('should start workflow with worktree and auto-generated branch/directory', async () => {
    mockSendCommand.mockResolvedValue({ success: true });

    const command = new StartCommand(mockContext);
    await command.execute('my-wf', { worktree: true });

    expect(mockGetTopLevel).toHaveBeenCalled();
    expect(mockSendCommand).toHaveBeenCalledWith('start', expect.objectContaining({
      name: 'my-wf',
      isWorktree: true,
      sourceRepo: '/mock/repo',
      branch: expect.stringMatching(/^my-wf-[0-9a-f]{6}$/),
      dir: expect.stringContaining(path.join('/mock/repo', '.afk-coder', 'worktrees'))
    }));
    expect(mockAddSafeDirectory).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('Workflow my-wf started successfully.');
  });

  it('should use user provided branch and dir for worktree', async () => {
    mockSendCommand.mockResolvedValue({ success: true });

    const command = new StartCommand(mockContext);
    await command.execute('my-wf', { worktree: true, branch: 'custom-br', dir: '/custom/dir' });

    expect(mockSendCommand).toHaveBeenCalledWith('start', expect.objectContaining({
      name: 'my-wf',
      isWorktree: true,
      branch: 'custom-br',
      dir: '/custom/dir'
    }));
  });

  it('should fail if worktree option is used outside git repository', async () => {
    mockGetTopLevel.mockImplementation(() => {
      throw new Error('Not a git repository');
    });

    const command = new StartCommand(mockContext);
    await command.execute('my-wf', { worktree: true });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Validation failed: --worktree must be run from inside a git repository');
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it('should handle daemon error response', async () => {
    mockSendCommand.mockResolvedValue({ success: false, message: 'Workflow name already exists' });

    const command = new StartCommand(mockContext);
    await command.execute('my-wf', { dir: '/test/dir' });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to start workflow: Workflow name already exists');
  });

  it('should warn if safe directory setup fails', async () => {
    mockSendCommand.mockResolvedValue({ success: true });
    mockAddSafeDirectory.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const command = new StartCommand(mockContext);
    await command.execute('my-wf', { worktree: true, dir: '/custom/dir' });

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: Could not configure git safe.directory'));
  });

  it('should handle general exceptions', async () => {
    mockSendCommand.mockRejectedValue(new Error('Fatal exception'));

    const command = new StartCommand(mockContext);
    await command.execute('my-wf', { dir: '/test/dir' });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Fatal exception');
  });

  it('should instantiate ShellGitClient if gitClientFactory is not provided', async () => {
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/');
    // Creating context without gitClientFactory
    const contextNoGitFactory = {
      client: {
        sendCommand: mockSendCommand,
      } as unknown as DaemonClient,
      validator: {
        validateWorkflowDir: mockValidateWorkflowDir,
      } as unknown as TaskValidator,
    };
    mockSendCommand.mockResolvedValue({ success: true });

    const command = new StartCommand(contextNoGitFactory);
    // This will trigger git client check at process.cwd() which returns '/' and is not a git repo, throwing an error.
    await command.execute('my-wf', { worktree: true });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Validation failed: --worktree must be run from inside a git repository'));
    cwdSpy.mockRestore();
  });

  it('should call execute when command is parsed by Commander', async () => {
    mockSendCommand.mockResolvedValue({ success: true });
    const program = new Command();
    const command = new StartCommand(mockContext);
    command.register(program);

    await program.parseAsync(['node', 'test', 'start', 'my-wf', '--dir', '/custom/dir']);
    expect(mockSendCommand).toHaveBeenCalledWith('start', expect.objectContaining({ name: 'my-wf', dir: path.resolve('/custom/dir') }));
  });
});
