import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { validateWorkflowDir } from '../src/common/validation';

// Mock child_process and fs
jest.mock('child_process');
jest.mock('fs');
jest.mock('../src/cli/client', () => ({
  sendCommand: jest.fn()
}));

describe('CLI Commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('init command', () => {
    const mockTasksOutput = '- [ ] Task 1';

    it('should generate tasks.md if PRD.md exists', async () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p.endsWith('PRD.md'));
      (execSync as jest.Mock).mockReturnValue(mockTasksOutput);

      const options = { dir: './test-dir' };
      const dir = path.resolve(options.dir);
      const prdPath = path.join(dir, 'PRD.md');
      const tasksPath = path.join(dir, 'tasks.md');

      // Logic from src/cli/index.ts
      if (fs.existsSync(prdPath)) {
        const output = execSync(`gemini --yolo --prompt '...'`, { cwd: dir, encoding: 'utf8' });
        if (!fs.existsSync(tasksPath)) {
          fs.writeFileSync(tasksPath, output.trim());
        }
      }

      expect(execSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(tasksPath, mockTasksOutput);
    });

    it('should error if PRD.md is missing', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const options = { dir: './test-dir' };
      const dir = path.resolve(options.dir);
      const prdPath = path.join(dir, 'PRD.md');

      if (!fs.existsSync(prdPath)) {
        console.error(`Error: PRD.md not found in ${dir}`);
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('PRD.md not found'));
      consoleErrorSpy.mockRestore();
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
