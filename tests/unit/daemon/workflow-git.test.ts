import { WorkflowGitManager } from '../../../src/daemon/workflow-git';
import { GitClient } from '../../../src/common/git';
import { Agent } from '../../../src/daemon/agent';
import { ConfigManager } from '../../../src/common/config';
import * as winston from 'winston';

describe('WorkflowGitManager', () => {
  let mockGit: jest.Mocked<GitClient>;
  let mockLogger: jest.Mocked<winston.Logger>;
  let mockConfigManager: jest.Mocked<ConfigManager>;
  let mockAgent: jest.Mocked<Agent>;
  let gitManager: WorkflowGitManager;

  beforeEach(() => {
    mockGit = {
      getTopLevel: jest.fn(),
      add: jest.fn(),
      reset: jest.fn(),
      status: jest.fn(),
      hasChanges: jest.fn(),
      hasStagedChanges: jest.fn(),
      commit: jest.fn(),
      pruneWorktrees: jest.fn(),
      hasBranch: jest.fn(),
      addWorktree: jest.fn(),
      createWorktree: jest.fn(),
      removeWorktree: jest.fn(),
      addSafeDirectory: jest.fn(),
      removeSafeDirectory: jest.fn(),
    } as unknown as jest.Mocked<GitClient>;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<winston.Logger>;

    mockConfigManager = {
      loadConfig: jest.fn(),
    } as unknown as jest.Mocked<ConfigManager>;

    mockAgent = {
      generateCommitMessage: jest.fn(),
    } as unknown as jest.Mocked<Agent>;

    gitManager = new WorkflowGitManager(
      mockGit,
      mockLogger,
      '/mock/configDir',
      mockConfigManager
    );
  });

  describe('isAutoCommitEnabled', () => {
    it('should return true if config has autoCommit set to true', () => {
      mockConfigManager.loadConfig.mockReturnValue({
        sandbox: { image: '', memory: 0, nanoCpus: 0 },
        git: { autoCommit: true }
      });
      expect(gitManager.isAutoCommitEnabled()).toBe(true);
    });

    it('should return false if config has autoCommit set to false', () => {
      mockConfigManager.loadConfig.mockReturnValue({
        sandbox: { image: '', memory: 0, nanoCpus: 0 },
        git: { autoCommit: false }
      });
      expect(gitManager.isAutoCommitEnabled()).toBe(false);
    });

    it('should return false if config loading throws', () => {
      mockConfigManager.loadConfig.mockImplementation(() => {
        throw new Error('Config load error');
      });
      expect(gitManager.isAutoCommitEnabled()).toBe(false);
    });
  });

  describe('autoCommitTask', () => {
    it('should add files and commit if there are changes', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      await gitManager.autoCommitTask('test description');
      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.commit).toHaveBeenCalledWith('feat: test description');
      expect(mockLogger.info).toHaveBeenCalledWith('Committed changes for task: test description');
    });

    it('should not commit if there are no changes', async () => {
      mockGit.hasChanges.mockReturnValue(false);
      await gitManager.autoCommitTask('test description');
      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.commit).not.toHaveBeenCalled();
    });

    it('should log a warning if commit throws an error', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      mockGit.commit.mockImplementation(() => {
        throw new Error('Git error');
      });
      await gitManager.autoCommitTask('test description');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to commit changes for task'));
    });
  });

  describe('autoCommitCompletion', () => {
    it('should commit completion message if there are changes', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      await gitManager.autoCommitCompletion();
      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.commit).toHaveBeenCalledWith('chore: workflow completed successfully');
      expect(mockLogger.info).toHaveBeenCalledWith('Committed final changes at workflow completion');
    });
  });

  describe('autoCommitFailure', () => {
    it('should commit failure message with status if there are changes', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      await gitManager.autoCommitFailure('Failed: Test error');
      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.commit).toHaveBeenCalledWith('chore: workflow failed - Failed: Test error');
    });
  });

  describe('autoCommitBeforeRemoval', () => {
    it('should stage, reset specific files, and commit with generated message if staged changes exist', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      mockGit.hasStagedChanges.mockReturnValue(true);
      mockAgent.generateCommitMessage.mockResolvedValue('generated msg');

      const milestones: any[] = [];
      const onMilestone = (m: any) => milestones.push(m);

      await gitManager.autoCommitBeforeRemoval(mockAgent, '/wf/dir', onMilestone);

      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.reset).toHaveBeenCalledWith('tasks.md');
      expect(mockGit.reset).toHaveBeenCalledWith('PRD.md');
      expect(mockAgent.generateCommitMessage).toHaveBeenCalledWith('/wf/dir', '/mock/configDir');
      expect(mockGit.commit).toHaveBeenCalledWith('generated msg');
      expect(milestones).toContainEqual(expect.objectContaining({
        message: 'Checking for uncommitted changes...'
      }));
      expect(milestones).toContainEqual(expect.objectContaining({
        message: 'Generating commit message using AI...'
      }));
      expect(milestones).toContainEqual(expect.objectContaining({
        message: 'Committing changes: "generated msg"...'
      }));
    });

    it('should not commit if no staged changes remain after reset', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      mockGit.hasStagedChanges.mockReturnValue(false);

      const milestones: any[] = [];
      const onMilestone = (m: any) => milestones.push(m);

      await gitManager.autoCommitBeforeRemoval(mockAgent, '/wf/dir', onMilestone);

      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.commit).not.toHaveBeenCalled();
      expect(milestones).toContainEqual(expect.objectContaining({
        message: 'No other changes to commit.'
      }));
    });

    it('should log an error and milestone update if autoCommitBeforeRemoval throws', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      mockGit.hasStagedChanges.mockReturnValue(true);
      mockAgent.generateCommitMessage.mockRejectedValue(new Error('AI generation crashed'));

      const milestones: any[] = [];
      const onMilestone = (m: any) => milestones.push(m);

      await gitManager.autoCommitBeforeRemoval(mockAgent, '/wf/dir', onMilestone);

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to auto-commit changes before removing'));
      expect(milestones).toContainEqual(expect.objectContaining({
        message: expect.stringContaining('Skipped auto-commit due to error')
      }));
    });
  });

  describe('autoCommitCompletion errors', () => {
    it('should log warning on throw', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      mockGit.commit.mockImplementation(() => {
        throw new Error('Write lock fail');
      });
      await gitManager.autoCommitCompletion();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to make final commit'));
    });
  });

  describe('autoCommitFailure errors', () => {
    it('should log warning on throw', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      mockGit.commit.mockImplementation(() => {
        throw new Error('Write lock fail');
      });
      await gitManager.autoCommitFailure('Failed state');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to make failure commit'));
    });
  });

  describe('autoCommitFailureWithException', () => {
    it('should commit success on changes', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      await gitManager.autoCommitFailureWithException();
      expect(mockGit.commit).toHaveBeenCalledWith('chore: workflow failed with exception');
    });

    it('should ignore errors when committing throws', async () => {
      mockGit.hasChanges.mockReturnValue(true);
      mockGit.commit.mockImplementation(() => {
        throw new Error('Git fail silently');
      });
      await expect(gitManager.autoCommitFailureWithException()).resolves.not.toThrow();
    });
  });

  describe('Constructor fallback', () => {
    it('should default configManager if not provided', () => {
      const defaultGitMgr = new WorkflowGitManager(mockGit, mockLogger, '/mock/configDir');
      expect((defaultGitMgr as any).configManager).toBeDefined();
    });
  });
});

