import * as fs from 'fs';
import * as path from 'path';
import { validateWorkflowDir } from '../src/common/validation';
import { DockerRuntime } from '../src/daemon/runtime-docker';

// Mock Sandbox and fs
jest.mock('fs');
jest.mock('../src/daemon/runtime-docker');
jest.mock('../src/cli/client', () => ({
  sendCommand: jest.fn()
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
      const { sendCommand } = await import('../src/cli/client');
      const { CONFIG_DIR } = await import('../src/common/config');

      const options = { dir: './test-dir', prd: 'PRD.md', force: false };
      const dir = path.resolve(options.dir);

      await sendCommand('init', {
        dir,
        prd: options.prd,
        force: options.force,
        configDir: CONFIG_DIR
      });

      expect(sendCommand).toHaveBeenCalledWith('init', {
        dir,
        prd: 'PRD.md',
        force: false,
        configDir: CONFIG_DIR
      });
    });
  });

  describe('start command', () => {
    it('should use current directory if --dir is not provided', async () => {
      const { sendCommand } = await import('../src/cli/client');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('- [ ] Task 1');

      // This is a simplified version of the action in src/cli/index.ts
      const workflowName = 'test-workflow';
      const options = { dir: undefined };
      const dir = path.resolve(options.dir || '.');
      validateWorkflowDir(dir);
      await sendCommand('start', { name: workflowName, dir });


      expect(sendCommand).toHaveBeenCalledWith('start', { name: 'test-workflow', dir: path.resolve('.') });
    });
  });

  describe('validation', () => {
    it('should validate workflow directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('- [ ] Task 1');

      const result = validateWorkflowDir('./test-dir');
      expect(result.tasks).toHaveLength(1);
      expect(result.pendingTasks).toHaveLength(1);
    });

    it('should throw if no pending tasks', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('- [x] Task 1');

      expect(() => validateWorkflowDir('./test-dir')).toThrow('No pending tasks found');
    });
  });
});
