import { GitClient } from '../../src/common/git';

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
