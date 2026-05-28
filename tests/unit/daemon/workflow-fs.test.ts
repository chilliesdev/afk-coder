import * as fs from 'node:fs';
import * as path from 'node:path';
import { DefaultWorkflowFileSystem } from '../../../src/daemon/workflow-fs';
import { execSync } from 'node:child_process';

const fsMod = require('node:fs');

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

describe('DefaultWorkflowFileSystem', () => {
  const tempDir = path.join(__dirname, 'temp-workflow-fs-test');
  let fileSystem: DefaultWorkflowFileSystem;

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir);
    fileSystem = new DefaultWorkflowFileSystem();
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('safeMoveSync', () => {
    it('should rename a file successfully', () => {
      const src = path.join(tempDir, 'src.txt');
      const dest = path.join(tempDir, 'dest.txt');
      fs.writeFileSync(src, 'hello');

      fileSystem.safeMoveSync(src, dest);

      expect(fs.existsSync(src)).toBe(false);
      expect(fs.existsSync(dest)).toBe(true);
      expect(fs.readFileSync(dest, 'utf8')).toBe('hello');
    });

    it('should fallback to copy and unlink on EXDEV error', () => {
      const src = path.join(tempDir, 'src-exdev.txt');
      const dest = path.join(tempDir, 'dest-exdev.txt');
      fs.writeFileSync(src, 'hello-exdev');

      const renameError = new Error('EXDEV error');
      (renameError as any).code = 'EXDEV';
      const spyRename = jest.spyOn(fsMod, 'renameSync').mockImplementation(() => {
        throw renameError;
      });

      try {
        fileSystem.safeMoveSync(src, dest);
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.existsSync(dest)).toBe(true);
        expect(fs.readFileSync(dest, 'utf8')).toBe('hello-exdev');
      } finally {
        spyRename.mockRestore();
      }
    });

    it('should propagate other rename errors', () => {
      const src = path.join(tempDir, 'src-fail.txt');
      const dest = path.join(tempDir, 'dest-fail.txt');
      fs.writeFileSync(src, 'hello');

      const spyRename = jest.spyOn(fsMod, 'renameSync').mockImplementation(() => {
        throw new Error('Some other error');
      });

      try {
        expect(() => fileSystem.safeMoveSync(src, dest)).toThrow('Some other error');
      } finally {
        spyRename.mockRestore();
      }
    });
  });

  describe('deleteDirectory', () => {
    it('should delete a directory successfully', () => {
      const targetDir = path.join(tempDir, 'to-delete');
      fs.mkdirSync(targetDir);
      fs.writeFileSync(path.join(targetDir, 'file.txt'), 'content');

      fileSystem.deleteDirectory(targetDir);

      expect(fs.existsSync(targetDir)).toBe(false);
    });

    it('should call ensureDirectoryWritable on initial rmSync error and retry', () => {
      const targetDir = path.join(tempDir, 'to-delete-fail');
      fs.mkdirSync(targetDir);

      let callCount = 0;
      const originalRmSync = fs.rmSync;
      const spyRmSync = jest.spyOn(fsMod, 'rmSync').mockImplementation((p: any, opt: any) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Permission denied');
        }
        originalRmSync(p, opt);
      });

      const spyEnsure = jest.spyOn(fileSystem, 'ensureDirectoryWritable').mockImplementation(() => {});

      try {
        fileSystem.deleteDirectory(targetDir);
        expect(spyEnsure).toHaveBeenCalledWith(targetDir, undefined, undefined, undefined);
        expect(fs.existsSync(targetDir)).toBe(false);
      } finally {
        spyRmSync.mockRestore();
        spyEnsure.mockRestore();
      }
    });
  });

  describe('ensureDirectoryWritable', () => {
    it('should run chown using docker command', () => {
      const targetDir = path.join(tempDir, 'target');
      fs.mkdirSync(targetDir);

      fileSystem.ensureDirectoryWritable(targetDir);

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('docker run --rm -v'),
        { stdio: 'ignore' }
      );
    });
  });
});
