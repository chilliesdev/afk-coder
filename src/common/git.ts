import { execSync } from 'node:child_process';

export interface GitClient {
  getTopLevel(): string;
  add(pattern?: string): void;
  reset(pattern: string): void;
  status(): string;
  hasChanges(): boolean;
  hasStagedChanges(): boolean;
  commit(message: string): void;
  pruneWorktrees(): void;
  hasBranch(branch: string): boolean;
  addWorktree(targetPath: string, branch: string): void;
  createWorktree(targetPath: string, branch: string): void;
  removeWorktree(targetPath: string): void;
  addSafeDirectory(targetPath: string): void;
  removeSafeDirectory(targetPath: string): void;
}


export class ShellGitClient implements GitClient {
  constructor(private readonly dir: string) {}

  private exec(args: string[], options: { stdio?: 'ignore' | 'pipe' } = {}): string {
    const cmd = `git -c safe.directory=* ${args.join(' ')}`;
    const result = execSync(cmd, {
      cwd: this.dir,
      encoding: 'utf-8',
      stdio: options.stdio || 'pipe',
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: '*',
        GIT_CONFIG_PARAMETERS: "'safe.directory=*'"
      }
    });
    return (result || '').toString().trim();
  }

  getTopLevel(): string {
    return this.exec(['rev-parse', '--show-toplevel']);
  }

  add(pattern: string = '.'): void {
    this.exec(['add', pattern]);
  }

  reset(pattern: string): void {
    this.exec(['reset', '--', pattern]);
  }

  status(): string {
    return this.exec(['status', '--porcelain']);
  }

  hasChanges(): boolean {
    return this.status().length > 0;
  }

  hasStagedChanges(): boolean {
    return this.exec(['diff', '--cached', '--name-only']).length > 0;
  }

  commit(message: string): void {
    this.exec(['commit', '-m', `"${message}"`]);
  }

  pruneWorktrees(): void {
    this.exec(['worktree', 'prune']);
  }

  hasBranch(branch: string): boolean {
    try {
      this.exec(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  addWorktree(targetPath: string, branch: string): void {
    this.exec(['worktree', 'add', `"${targetPath}"`, branch]);
  }

  createWorktree(targetPath: string, branch: string): void {
    this.exec(['worktree', 'add', '-b', branch, `"${targetPath}"`]);
  }

  removeWorktree(targetPath: string): void {
    this.exec(['worktree', 'remove', '--force', `"${targetPath}"`]);
  }

  addSafeDirectory(targetPath: string): void {
    try {
      execSync(`git config --global --add safe.directory "${targetPath}"`, { stdio: 'ignore' });
    } catch {
      // Ignore errors if global config is not writable
    }
  }

  removeSafeDirectory(targetPath: string): void {
    try {
      execSync(`git config --global --unset-all safe.directory "${targetPath}"`, { stdio: 'ignore' });
    } catch {
      // Ignore errors
    }
  }
}

export class MockGitClient implements GitClient {
  public topLevel: string = '/mock/repo';
  public changesStatus: string = '';
  public branches: Set<string> = new Set();
  public worktrees: Map<string, string> = new Map(); // targetPath -> branch
  public commits: { message: string }[] = [];
  public added: string[] = [];
  public resets: string[] = [];
  public mockHasStagedChanges: boolean = false;
  public pruned: boolean = false;

  constructor(public readonly dir: string) {}

  getTopLevel(): string {
    return this.topLevel;
  }

  add(pattern: string = '.'): void {
    this.added.push(pattern);
  }

  reset(pattern: string): void {
    this.resets.push(pattern);
  }

  status(): string {
    return this.changesStatus;
  }

  hasChanges(): boolean {
    return this.changesStatus.trim().length > 0;
  }

  hasStagedChanges(): boolean {
    return this.mockHasStagedChanges;
  }

  commit(message: string): void {
    this.commits.push({ message });
  }

  pruneWorktrees(): void {
    this.pruned = true;
  }

  hasBranch(branch: string): boolean {
    return this.branches.has(branch);
  }

  addWorktree(targetPath: string, branch: string): void {
    this.worktrees.set(targetPath, branch);
  }

  createWorktree(targetPath: string, branch: string): void {
    this.branches.add(branch);
    this.worktrees.set(targetPath, branch);
  }

  removeWorktree(targetPath: string): void {
    this.worktrees.delete(targetPath);
  }

  public safeDirectories: string[] = [];

  addSafeDirectory(targetPath: string): void {
    this.safeDirectories.push(targetPath);
  }

  removeSafeDirectory(targetPath: string): void {
    this.safeDirectories = this.safeDirectories.filter(d => d !== targetPath);
  }
}
