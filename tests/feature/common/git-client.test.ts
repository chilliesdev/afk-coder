import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { ShellGitClient } from '../../../src/common/git';
import { MockGitClient } from '../../helpers/mock-git-client';

describe('GitClient', () => {
  describe('MockGitClient', () => {
    it('should correctly simulate git status, add, and commit', () => {
      const git = new MockGitClient('/mock/path');
      expect(git.getTopLevel()).toBe('/mock/repo');
      expect(git.hasChanges()).toBe(false);

      git.changesStatus = 'M file.txt';
      expect(git.hasChanges()).toBe(true);

      git.add('file.txt');
      expect(git.added).toContain('file.txt');

      git.commit('test commit');
      expect(git.commits).toHaveLength(1);
      expect(git.commits[0].message).toBe('test commit');
    });

    it('should correctly simulate worktree operations', () => {
      const git = new MockGitClient('/mock/path');
      git.createWorktree('/mock/wt', 'new-branch');
      expect(git.branches.has('new-branch')).toBe(true);
      expect(git.worktrees.get('/mock/wt')).toBe('new-branch');

      expect(git.hasBranch('new-branch')).toBe(true);
      expect(git.hasBranch('other-branch')).toBe(false);

      git.removeWorktree('/mock/wt');
      expect(git.worktrees.has('/mock/wt')).toBe(false);
    });

    it('should correctly simulate safe directory operations', () => {
      const git = new MockGitClient('/mock/path');
      git.addSafeDirectory('/mock/safe-dir');
      expect(git.safeDirectories).toContain('/mock/safe-dir');

      git.removeSafeDirectory('/mock/safe-dir');
      expect(git.safeDirectories).not.toContain('/mock/safe-dir');
    });
  });

  describe('ShellGitClient', () => {
    const testRepoDir = path.resolve('./test-git-client-repo');

    beforeAll(() => {
      if (fs.existsSync(testRepoDir)) {
        fs.rmSync(testRepoDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testRepoDir, { recursive: true });
      
      // Initialize a real temporary git repository
      execSync('git init', { cwd: testRepoDir });
      // Set git config to allow committing in test environment without issues
      execSync('git config user.name "Test User"', { cwd: testRepoDir });
      execSync('git config user.email "test@example.com"', { cwd: testRepoDir });
    });

    afterAll(() => {
      if (fs.existsSync(testRepoDir)) {
        fs.rmSync(testRepoDir, { recursive: true, force: true });
      }
    });

    it('should retrieve top-level directory', () => {
      const git = new ShellGitClient(testRepoDir);
      const topLevel = git.getTopLevel();
      // Resolves symbolic links or case mismatches if any
      expect(path.resolve(topLevel)).toBe(path.resolve(testRepoDir));
    });

    it('should detect status changes, add, and commit', () => {
      const git = new ShellGitClient(testRepoDir);
      expect(git.hasChanges()).toBe(false);

      const filePath = path.join(testRepoDir, 'dummy.txt');
      fs.writeFileSync(filePath, 'hello');

      expect(git.hasChanges()).toBe(true);
      expect(git.status()).toContain('dummy.txt');

      git.add('dummy.txt');
      git.commit('initial commit');

      expect(git.hasChanges()).toBe(false);
    });

    it('should check if branch exists', () => {
      const git = new ShellGitClient(testRepoDir);
      // git init might create 'main' or 'master' depending on git config, but our commit was on it.
      // Let's create a known branch 'test-branch'
      execSync('git branch test-branch', { cwd: testRepoDir });

      expect(git.hasBranch('test-branch')).toBe(true);
      expect(git.hasBranch('non-existent-branch')).toBe(false);
    });

    it('should add and remove safe directory globally', () => {
      const git = new ShellGitClient(testRepoDir);
      const testPath = '/tmp/dummy-test-safe-dir';

      expect(() => git.addSafeDirectory(testPath)).not.toThrow();

      const globalConfig = execSync('git config --global --get-all safe.directory || true', { encoding: 'utf-8' });
      expect(globalConfig).toContain(testPath);

      expect(() => git.removeSafeDirectory(testPath)).not.toThrow();

      const globalConfigAfter = execSync('git config --global --get-all safe.directory || true', { encoding: 'utf-8' });
      expect(globalConfigAfter).not.toContain(testPath);
    });
  });
});
