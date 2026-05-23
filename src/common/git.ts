import { execSync } from 'node:child_process';

export interface GitClient {
  getTopLevel(): string;
  add(pattern?: string): void;
  status(): string;
  hasChanges(): boolean;
  commit(message: string): void;
  pruneWorktrees(): void;
  hasBranch(branch: string): boolean;
  addWorktree(targetPath: string, branch: string): void;
  createWorktree(targetPath: string, branch: string): void;
  removeWorktree(targetPath: string): void;
}

export class ShellGitClient implements GitClient {
  constructor(private readonly dir: string) {}

  private exec(args: string[], options: { stdio?: 'ignore' | 'pipe' } = {}): string {
    const cmd = `git -c safe.directory=* ${args.join(' ')}`;
    const result = execSync(cmd, {
      cwd: this.dir,
      encoding: 'utf-8',
      stdio: options.stdio || 'pipe'
    });
    return (result || '').toString().trim();
  }

  getTopLevel(): string {
    // Note: The original code used 'git rev-parse --show-toplevel' without the '-c safe.directory=*' prefix.
    // For compatibility and consistency, we can construct the exact command.
    const result = execSync('git rev-parse --show-toplevel', {
      cwd: this.dir,
      encoding: 'utf-8'
    });
    return (result || '').toString().trim();
  }

  add(pattern: string = '.'): void {
    this.exec(['add', pattern]);
  }

  status(): string {
    return this.exec(['status', '--porcelain']);
  }

  hasChanges(): boolean {
    return this.status().length > 0;
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
}

export class MockGitClient implements GitClient {
  public topLevel: string = '/mock/repo';
  public changesStatus: string = '';
  public branches: Set<string> = new Set();
  public worktrees: Map<string, string> = new Map(); // targetPath -> branch
  public commits: { message: string }[] = [];
  public added: string[] = [];
  public pruned: boolean = false;

  constructor(public readonly dir: string) {}

  getTopLevel(): string {
    return this.topLevel;
  }

  add(pattern: string = '.'): void {
    this.added.push(pattern);
  }

  status(): string {
    return this.changesStatus;
  }

  hasChanges(): boolean {
    return this.changesStatus.trim().length > 0;
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
}
