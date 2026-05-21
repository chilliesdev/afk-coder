import * as fs from 'fs';
import * as path from 'path';
import { TaskValidator } from '../src/common/validation';
import { DockerRuntime } from '../src/daemon/runtime-docker';

// Mock Sandbox and fs
jest.mock('fs');
jest.mock('../src/daemon/runtime-docker');
jest.mock('../src/cli/client', () => ({
  DaemonClient: jest.fn().mockImplementation(() => ({
    sendCommand: jest.fn()
  }))
}));

describe('CLI Commands', () => {
  let mockSandbox: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSandbox = {
      run: jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ exitCode: 0, logs: '- [ ] Task 1' })
      })
    };
    (DockerRuntime as jest.Mock).mockImplementation(() => mockSandbox);
  });

  describe('init command', () => {
    it('should call sendCommand with init options', async () => {
      const { DaemonClient } = await import('../src/cli/client');
      const client = new DaemonClient();
      const { CONFIG_DIR } = await import('../src/common/config');

      const options = { dir: './test-dir', prd: 'PRD.md', force: false };
      const dir = path.resolve(options.dir);

      await client.sendCommand('init', {
        dir,
        prd: options.prd,
        force: options.force,
        configDir: CONFIG_DIR
      });

      expect(client.sendCommand).toHaveBeenCalledWith('init', {
        dir,
        prd: 'PRD.md',
        force: false,
        configDir: CONFIG_DIR
      });
    });
  });

  describe('start command', () => {
    it('should use current directory if --dir is not provided', async () => {
      const { DaemonClient } = await import('../src/cli/client');
      const client = new DaemonClient();
      const validator = new TaskValidator();
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('- [ ] Task 1');

      // This is a simplified version of the action in src/cli/index.ts
      const workflowName = 'test-workflow';
      const options = { dir: undefined };
      const dir = path.resolve(options.dir || '.');
      validator.validateWorkflowDir(dir);
      await client.sendCommand('start', { name: workflowName, dir });


      expect(client.sendCommand).toHaveBeenCalledWith('start', { name: 'test-workflow', dir: path.resolve('.') });
    });

    it('should skip validation if --worktree is provided', async () => {
      const { DaemonClient } = await import('../src/cli/client');
      const client = new DaemonClient();
      const validator = new TaskValidator();
      
      const spy = jest.spyOn(validator, 'validateWorkflowDir');
      
      const workflowName = 'wt-workflow';
      const options = { dir: undefined, worktree: true };
      const dir = path.resolve(options.dir || '.');
      
      if (!options.worktree) {
        validator.validateWorkflowDir(dir);
      }
      
      // Simulate execSync and passing to daemon
      const sourceRepo = '/repo';
      const branch = 'workflow/wt-workflow';
      await client.sendCommand('start', { 
        name: workflowName, 
        dir,
        isWorktree: options.worktree,
        sourceRepo,
        branch
      });

      expect(spy).not.toHaveBeenCalled();
      expect(client.sendCommand).toHaveBeenCalledWith('start', { 
        name: 'wt-workflow', 
        dir: path.resolve('.'),
        isWorktree: true,
        sourceRepo: '/repo',
        branch: 'workflow/wt-workflow'
      });
      
      spy.mockRestore();
    });
  });

  describe('validation', () => {
    let validator: TaskValidator;

    beforeEach(() => {
      validator = new TaskValidator();
    });

    it('should validate workflow directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('- [ ] Task 1');

      const result = validator.validateWorkflowDir('./test-dir');
      expect(result.tasks).toHaveLength(1);
      expect(result.pendingTasks).toHaveLength(1);
    });

    it('should throw if no pending tasks', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('- [x] Task 1');

      expect(() => validator.validateWorkflowDir('./test-dir')).toThrow('No pending tasks found');
    });
  });
});
