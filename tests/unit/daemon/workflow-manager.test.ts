import { WorkflowManager } from '../../../src/daemon/workflow-manager';
import { MockRuntime } from '../../helpers/mock-runtime';
import { TaskBoard } from '../../../src/daemon/task-board';
import { InMemoryTaskStorage, FileSystemTaskStorage } from '../../../src/daemon/task-storage';
import { Agent } from '../../../src/daemon/agent';
import { GeminiAdapter } from '../../../src/daemon/agent-gemini';
import { OutcomeAnalyzer } from '../../../src/daemon/agent-outcome';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'node:child_process';
import { MockGitClient } from '../../helpers/mock-git-client';
import { TaskValidator } from '../../../src/common/validation';
import * as winston from 'winston';
import { MilestoneEvent, MILESTONE_STATUS } from '../../../src/common/types';

jest.mock('node:child_process', () => ({
  execSync: jest.fn()
}));

describe('WorkflowManager', () => {
  let workflowManager: WorkflowManager;
  let mockRuntime: MockRuntime;
  let mockTaskBoard: TaskBoard;
  let inMemoryStorage: InMemoryTaskStorage;
  const testDir = path.resolve('./test-workflow-manager');
  const sourceRepoDir = path.resolve('./test-workflow-manager-source');
  const testStateDir = path.resolve('./test-xdg-state');
  let originalXdgStateHome: string | undefined;

  const resetBoard = async (content: string) => {
    await inMemoryStorage.write(content);
    await mockTaskBoard.load();
  };

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    if (fs.existsSync(sourceRepoDir)) {
      fs.rmSync(sourceRepoDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testStateDir)) {
      fs.rmSync(testStateDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir);
    fs.mkdirSync(sourceRepoDir);
    fs.mkdirSync(testStateDir);

    originalXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = testStateDir;

    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD\nTest PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
    (execSync as jest.Mock).mockClear();

    mockRuntime = new MockRuntime();
    inMemoryStorage = new InMemoryTaskStorage('- [ ] Task 1');
    mockTaskBoard = new TaskBoard(inMemoryStorage);
    
    workflowManager = new WorkflowManager(
      () => new Agent(mockRuntime, new OutcomeAnalyzer(), new GeminiAdapter()),
      () => mockTaskBoard
    );

    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.useRealTimers();
    process.env.XDG_STATE_HOME = originalXdgStateHome;
    if (workflowManager) {
      const workflows = workflowManager.listWorkflows();
      for (const wf of workflows) {
        try {
          await workflowManager.killWorkflow(wf.name);
        } catch {}
      }
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
    if (fs.existsSync(sourceRepoDir)) {
      try {
        fs.rmSync(sourceRepoDir, { recursive: true, force: true });
      } catch {}
    }
    if (fs.existsSync(testStateDir)) {
      try {
        fs.rmSync(testStateDir, { recursive: true, force: true });
      } catch {}
    }
    const testConfigDir = path.resolve('./test-config-wt-commit');
    if (fs.existsSync(testConfigDir)) {
      try {
        fs.rmSync(testConfigDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('should run a simple workflow to completion', async () => {
    await resetBoard('- [ ] Task 1');

    mockRuntime.nextResult = {
      exitCode: 0,
      logs: 'Success! Tokens: 10 in, 20 out'
    };
    
    // Simulate task completion on next reconcile by modifying the in-memory storage
    const originalReconcile = mockTaskBoard.reconcile.bind(mockTaskBoard);
    mockTaskBoard.reconcile = async () => {
      await inMemoryStorage.write('- [x] Task 1');
      return await originalReconcile();
    };

    await workflowManager.startWorkflow('test', testDir);
    
    const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

    // Wait for it to finish by advancing timers and flushing promises
    let attempts = 0;
    let workflow = workflowManager.getWorkflow('test');
    while (workflow && workflow.status !== 'Done' && attempts < 100) {
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises();
      workflow = workflowManager.getWorkflow('test');
      attempts++;
    }

    workflow = workflowManager.getWorkflow('test')!;
    expect(workflow.status).toBe('Done');
    expect(workflow.tokenUsage).toEqual({ input: 20, output: 40, total: 60 });
    expect(workflow.recentTasks).toContain('Task 1');
  });

  it('should handle quota errors with retries', async () => {
    await resetBoard('- [ ] Task 1');

    mockRuntime.nextResult = {
      exitCode: 1,
      logs: 'Error: 429 Too Many Requests'
    };

    await workflowManager.startWorkflow('test-quota', testDir);
    const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

    // Wait for it to detect quota error
    let attempts = 0;
    while (!workflowManager.getLogs('test-quota').content.includes('Gemini API quota exceeded') && attempts < 100) {
      await jest.advanceTimersByTimeAsync(100);
      await flushPromises();
      attempts++;
    }

    expect(workflowManager.getLogs('test-quota').content).toContain('Gemini API quota exceeded');
    
    // Cleanup
    await workflowManager.killWorkflow('test-quota');
  });

  it('should handle safety blocks', async () => {
    await resetBoard('- [ ] Task 1');

    mockRuntime.nextResult = {
      exitCode: 1,
      logs: 'Candidate was blocked due to safety'
    };

    await workflowManager.startWorkflow('test-safety', testDir);
    const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

    await jest.advanceTimersByTimeAsync(5000);
    await flushPromises();

    const workflow = workflowManager.getWorkflow('test-safety')!;
    expect(workflow.status).toBe('Failed: Safety Block');
    await workflowManager.killWorkflow('test-safety');
  });

  it('should handle multiple tasks and recover from errors', async () => {
    await resetBoard('- [ ] Task 1\n- [ ] Task 2');

    // First run fails with Quota
    mockRuntime.nextResult = {
      exitCode: 1,
      logs: 'Error: 429 Too Many Requests'
    };

    await workflowManager.startWorkflow('complex', testDir);
    const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

    // Wait for it to detect quota error
    let logAttempts = 0;
    while (!workflowManager.getLogs('complex').content.includes('Gemini API quota exceeded') && logAttempts < 100) {
      await jest.advanceTimersByTimeAsync(100);
      await flushPromises();
      logAttempts++;
    }
    expect(workflowManager.getLogs('complex').content).toContain('Gemini API quota exceeded');

    // Next run succeeds and completes Task 1
    mockRuntime.nextResult = {
      exitCode: 0,
      logs: 'Task 1 done! Tokens: 5 in, 10 out'
    };
    
    const originalRun = mockRuntime.run.bind(mockRuntime);
    mockRuntime.run = async (prompt, dir, configDir) => {
      const handle = await originalRun(prompt, dir, configDir);
      const originalWait = handle.wait.bind(handle);
      handle.wait = async () => {
        const result = await originalWait();
        if (result.exitCode === 0) {
           const tasks = mockTaskBoard.getTasks();
           const pending = tasks.find(t => !t.completed);
           if (pending) {
             pending.completed = true;
           }
           const updatedContent = tasks.map(t => `${t.completed ? '- [x]' : '- [ ]'} ${t.description}`).join('\n');
           await inMemoryStorage.write(updatedContent);
        }
        return result;
      };
      return handle;
    };

    // Advance to trigger retry
    await jest.advanceTimersByTimeAsync(65000);
    await flushPromises();

    // Wait for Task 1 to be processed
    let task1Attempts = 0;
    let workflow = workflowManager.getWorkflow('complex')!;
    while (!workflow.recentTasks.includes('Task 1') && task1Attempts < 100) {
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      workflow = workflowManager.getWorkflow('complex')!;
      task1Attempts++;
    }

    expect(workflow.recentTasks).toContain('Task 1');
    expect(['1/2', '2/2']).toContain(workflow.progress);

    // Next run completes Task 2 (if not already done)
    mockRuntime.nextResult = {
      exitCode: 0,
      logs: 'Task 2 done! Tokens: 5 in, 10 out'
    };

    // Advance to process Task 2 completion
    let task2Attempts = 0;
    while (workflow.status !== 'Done' && task2Attempts < 100) {
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      workflow = workflowManager.getWorkflow('complex')!;
      task2Attempts++;
    }

    expect(workflow.status).toBe('Done');
    expect(workflow.recentTasks).toContain('Task 2');
    expect(workflow.tokenUsage.input).toBeGreaterThanOrEqual(10);
  });

  describe('Git Worktree Support', () => {
    it('should create a worktree when isWorktree is true and branch exists', async () => {
      await resetBoard('- [ ] Task 1');
      fs.rmSync(testDir, { recursive: true, force: true });
      
      // Simulate branch exists and worktree creation
      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* worktree add')) {
          fs.mkdirSync(testDir, { recursive: true });
          fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD');
          fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
        }
        return Buffer.from('');
      });

      await workflowManager.startWorkflow('wt-test1', testDir, {
        isWorktree: true,
        sourceRepo: '/mock/repo',
        branch: 'workflow/wt-test1'
      });

      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* show-ref --verify --quiet refs/heads/workflow/wt-test1',
        expect.objectContaining({ cwd: '/mock/repo' })
      );
      expect(execSync).toHaveBeenCalledWith(
        `git -c safe.directory=* worktree add "${testDir}" workflow/wt-test1`,
        expect.objectContaining({ cwd: '/mock/repo' })
      );

      const workflow = workflowManager.getWorkflow('wt-test1')!;
      expect(workflow.isWorktree).toBe(true);
      expect(workflow.sourceRepo).toBe('/mock/repo');
      expect(workflow.branch).toBe('workflow/wt-test1');
      
      await workflowManager.killWorkflow('wt-test1');
    });

    it('should create a worktree with new branch when branch does not exist', async () => {
      await resetBoard('- [ ] Task 1');
      fs.rmSync(testDir, { recursive: true, force: true });
      
      // Simulate branch does not exist, then create worktree
      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* show-ref')) {
          throw new Error('Branch not found');
        }
        if (cmd.includes('git -c safe.directory=* worktree add')) {
          fs.mkdirSync(testDir, { recursive: true });
          fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD');
          fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
        }
        return Buffer.from('');
      });

      await workflowManager.startWorkflow('wt-test2', testDir, {
        isWorktree: true,
        sourceRepo: '/mock/repo',
        branch: 'workflow/wt-test2'
      });

      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* show-ref --verify --quiet refs/heads/workflow/wt-test2',
        expect.objectContaining({ cwd: '/mock/repo' })
      );
      expect(execSync).toHaveBeenCalledWith(
        `git -c safe.directory=* worktree add -b workflow/wt-test2 "${testDir}"`,
        expect.objectContaining({ cwd: '/mock/repo' })
      );
      
      await workflowManager.killWorkflow('wt-test2');
    });

    it('should remove worktree properly', async () => {
      await resetBoard('- [ ] Task 1');
      
      // Setup worktree workflow
      (execSync as jest.Mock).mockImplementationOnce(() => Buffer.from(''));
      await workflowManager.startWorkflow('wt-test3', testDir, {
        isWorktree: true,
        sourceRepo: '/mock/repo',
        branch: 'workflow/wt-test3'
      });

      // Mark as done
      const executor = (workflowManager as any).workflows.get('wt-test3');
      executor.status = 'Done';

      // Clear mock so we can just check remove
      (execSync as jest.Mock).mockClear();

      await workflowManager.removeWorkflow('wt-test3', undefined, true);

      expect(execSync).toHaveBeenCalledWith(
        `git -c safe.directory=* worktree remove --force "${testDir}"`,
        expect.objectContaining({ cwd: '/mock/repo' })
      );
    });

    it('should retry worktree removal with permission fixing using Docker if initial removal fails', async () => {
      // Setup worktree workflow
      (execSync as jest.Mock).mockImplementationOnce(() => Buffer.from(''));
      await workflowManager.startWorkflow('wt-test-retry-perm', testDir, {
        isWorktree: true,
        sourceRepo: '/mock/repo',
        branch: 'workflow/wt-test-retry-perm'
      });

      // Mark as done
      const executor = (workflowManager as any).workflows.get('wt-test-retry-perm');
      executor.status = 'Done';

      // Clear mock
      (execSync as jest.Mock).mockClear();

      // Mock first remove to fail, and second to succeed
      let callCount = 0;
      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('worktree remove')) {
          callCount++;
          if (callCount === 1) {
            throw new Error('Permission denied');
          }
        }
        return Buffer.from('');
      });

      await workflowManager.removeWorkflow('wt-test-retry-perm', undefined, true);

      // Verify it called chown in Docker run
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('docker run --rm -v'),
        expect.anything()
      );
      // Verify it retried worktree remove
      expect(callCount).toBe(2);
    });

    it('should move PRD.md and tasks.md from sourceRepo if they exist and are missing in worktree', async () => {
      const srcRepo = path.resolve('./test-src-repo');
      if (fs.existsSync(srcRepo)) {
        fs.rmSync(srcRepo, { recursive: true, force: true });
      }
      fs.mkdirSync(srcRepo);
      fs.writeFileSync(path.join(srcRepo, 'PRD.md'), '# Source PRD');
      fs.writeFileSync(path.join(srcRepo, 'tasks.md'), '- [ ] Task 1');

      fs.rmSync(testDir, { recursive: true, force: true });

      // Mock implementation to just create empty directory on worktree add
      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* worktree add')) {
          fs.mkdirSync(testDir, { recursive: true });
        }
        return Buffer.from('');
      });

      await workflowManager.startWorkflow('wt-test-copy', testDir, {
        isWorktree: true,
        sourceRepo: srcRepo,
        branch: 'workflow/wt-test-copy'
      });

      // Verify they were moved
      expect(fs.existsSync(path.join(testDir, 'PRD.md'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'tasks.md'))).toBe(true);
      expect(fs.readFileSync(path.join(testDir, 'PRD.md'), 'utf8')).toBe('# Source PRD');
      expect(fs.existsSync(path.join(srcRepo, 'PRD.md'))).toBe(false);
      expect(fs.existsSync(path.join(srcRepo, 'tasks.md'))).toBe(false);

      // Cleanup
      fs.rmSync(srcRepo, { recursive: true, force: true });
      await workflowManager.killWorkflow('wt-test-copy');
    });

    it('should stage and commit changes to the worktree branch when a task is completed', async () => {
      await resetBoard('- [ ] Task 1');
      fs.rmSync(testDir, { recursive: true, force: true });

      // Simulate worktree setup and write initial files
      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* worktree add')) {
          fs.mkdirSync(testDir, { recursive: true });
          fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD');
          fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
        }
        // Return dummy changes for git status
        if (cmd.includes('git -c safe.directory=* status --porcelain')) {
          return Buffer.from('M modified-file.ts\n');
        }
        return Buffer.from('');
      });

      mockRuntime.nextResult = {
        exitCode: 0,
        logs: 'Success! Tokens: 10 in, 20 out'
      };

      const originalReconcile = mockTaskBoard.reconcile.bind(mockTaskBoard);
      mockTaskBoard.reconcile = async () => {
        await inMemoryStorage.write('- [x] Task 1');
        fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [x] Task 1');
        return await originalReconcile();
      };

      const testConfigDir = path.resolve('./test-config-wt-commit');
      fs.mkdirSync(testConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(testConfigDir, 'config.json'),
        JSON.stringify({ git: { autoCommit: true } })
      );

      await workflowManager.startWorkflow('wt-test-commit', testDir, {
        isWorktree: true,
        sourceRepo: '/mock/repo',
        branch: 'workflow/wt-test-commit',
        configDir: testConfigDir
      });

      const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

      // Wait for it to finish
      let attempts = 0;
      let workflow = workflowManager.getWorkflow('wt-test-commit');
      while (workflow && workflow.status !== 'Done' && attempts < 100) {
        await jest.advanceTimersByTimeAsync(5000);
        await flushPromises();
        workflow = workflowManager.getWorkflow('wt-test-commit');
        attempts++;
      }

      // Assert that git add, status, and commit were called
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* add .',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* status --porcelain',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* commit -m "feat: Task 1"',
        expect.objectContaining({ cwd: testDir })
      );

      await workflowManager.killWorkflow('wt-test-commit');
    });

    it('should NOT stage or commit changes to the worktree branch when autoCommit is false', async () => {
      await resetBoard('- [ ] Task 1');
      fs.rmSync(testDir, { recursive: true, force: true });

      // Simulate worktree setup and write initial files
      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* worktree add')) {
          fs.mkdirSync(testDir, { recursive: true });
          fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD');
          fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
        }
        if (cmd.includes('git -c safe.directory=* status --porcelain')) {
          return Buffer.from('M modified-file.ts\n');
        }
        return Buffer.from('');
      });

      mockRuntime.nextResult = {
        exitCode: 0,
        logs: 'Success! Tokens: 10 in, 20 out'
      };

      const originalReconcile = mockTaskBoard.reconcile.bind(mockTaskBoard);
      mockTaskBoard.reconcile = async () => {
        await inMemoryStorage.write('- [x] Task 1');
        fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [x] Task 1');
        return await originalReconcile();
      };

      // Use default config directory (meaning autoCommit is false by default)
      await workflowManager.startWorkflow('wt-test-no-commit', testDir, {
        isWorktree: true,
        sourceRepo: '/mock/repo',
        branch: 'workflow/wt-test-no-commit'
      });

      const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

      // Wait for it to finish
      let attempts = 0;
      let workflow = workflowManager.getWorkflow('wt-test-no-commit');
      while (workflow && workflow.status !== 'Done' && attempts < 100) {
        await jest.advanceTimersByTimeAsync(5000);
        await flushPromises();
        workflow = workflowManager.getWorkflow('wt-test-no-commit');
        attempts++;
      }

      // Assert that git commit was NOT called for Task 1
      expect(execSync).not.toHaveBeenCalledWith(
        'git -c safe.directory=* commit -m "feat: Task 1"',
        expect.any(Object)
      );

      await workflowManager.killWorkflow('wt-test-no-commit');
    });

    it('should auto-commit uncommitted changes when removing a worktree workflow', async () => {
      await resetBoard('- [ ] Task 1');
      fs.rmSync(testDir, { recursive: true, force: true });

      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* worktree add')) {
          fs.mkdirSync(testDir, { recursive: true });
          fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD');
          fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
        }
        if (cmd.includes('git -c safe.directory=* status --porcelain')) {
          return Buffer.from('M modified-file.ts\n');
        }
        return Buffer.from('');
      });

      mockRuntime.nextResult = {
        exitCode: 0,
        logs: 'A nice commit message generated by the AI'
      };

      await workflowManager.startWorkflow('wt-test-remove-commit', testDir, {
        isWorktree: true,
        sourceRepo: sourceRepoDir,
        branch: 'workflow/wt-test-remove-commit'
      });

      // Mark the workflow as Done manually so we can remove it
      const executor = (workflowManager as any).workflows.get('wt-test-remove-commit');
      executor.status = 'Done';

      (execSync as jest.Mock).mockClear();

      // Mock the status check to simulate uncommitted changes
      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* status --porcelain')) {
          return Buffer.from('M modified-file.ts\n');
        }
        if (cmd.includes('git -c safe.directory=* diff --cached --name-only')) {
          return Buffer.from('modified-file.ts\n');
        }
        return Buffer.from('');
      });

      const milestones: any[] = [];
      await workflowManager.removeWorkflow('wt-test-remove-commit', (m) => milestones.push(m), true);

      expect(milestones).toContainEqual(
        expect.objectContaining({ status: 'starting' })
      );
      expect(milestones).toContainEqual(
        expect.objectContaining({ status: 'completed' })
      );

      // Assert archiving took place in the filesystem
      const archivedTasksPath = path.join(sourceRepoDir, '.afk-coder', 'tasks', 'wt-test-remove-commit', 'tasks.md');
      const archivedPrdPath = path.join(sourceRepoDir, '.afk-coder', 'tasks', 'wt-test-remove-commit', 'PRD.md');
      expect(fs.existsSync(archivedTasksPath)).toBe(true);
      expect(fs.existsSync(archivedPrdPath)).toBe(true);
      expect(fs.readFileSync(archivedTasksPath, 'utf8')).toContain('- [ ] Task 1');

      // Assert git add, resets, diff, and git commit were called
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* add .',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* reset -- tasks.md',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* reset -- PRD.md',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* diff --cached --name-only',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* commit -m "A nice commit message generated by the AI"',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).toHaveBeenCalledWith(
        `git -c safe.directory=* worktree remove --force "${testDir}"`,
        expect.objectContaining({ cwd: sourceRepoDir })
      );
    });

    it('should archive tasks.md and PRD.md and skip auto-commit when no other changes are present', async () => {
      await resetBoard('- [ ] Task 1');
      fs.rmSync(testDir, { recursive: true, force: true });

      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* worktree add')) {
          fs.mkdirSync(testDir, { recursive: true });
          fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD');
          fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
        }
        if (cmd.includes('git -c safe.directory=* status --porcelain')) {
          return Buffer.from('M tasks.md\nM PRD.md\n');
        }
        return Buffer.from('');
      });

      mockRuntime.nextResult = {
        exitCode: 0,
        logs: 'Success'
      };

      await workflowManager.startWorkflow('wt-test-remove-no-commit', testDir, {
        isWorktree: true,
        sourceRepo: sourceRepoDir,
        branch: 'workflow/wt-test-remove-no-commit'
      });

      const executor = (workflowManager as any).workflows.get('wt-test-remove-no-commit');
      executor.status = 'Done';

      (execSync as jest.Mock).mockClear();

      // Mock status check to simulate only tasks/PRD changes
      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* status --porcelain')) {
          return Buffer.from('M tasks.md\nM PRD.md\n');
        }
        if (cmd.includes('git -c safe.directory=* diff --cached --name-only')) {
          return Buffer.from('');
        }
        return Buffer.from('');
      });

      const milestones: any[] = [];
      await workflowManager.removeWorkflow('wt-test-remove-no-commit', (m) => milestones.push(m), true);

      expect(milestones).toContainEqual(
        expect.objectContaining({ status: 'starting' })
      );
      expect(milestones).toContainEqual(
        expect.objectContaining({ status: 'completed' })
      );

      // Assert archiving took place
      const archivedTasksPath = path.join(sourceRepoDir, '.afk-coder', 'tasks', 'wt-test-remove-no-commit', 'tasks.md');
      const archivedPrdPath = path.join(sourceRepoDir, '.afk-coder', 'tasks', 'wt-test-remove-no-commit', 'PRD.md');
      expect(fs.existsSync(archivedTasksPath)).toBe(true);
      expect(fs.existsSync(archivedPrdPath)).toBe(true);

      // Assert git add and resets were called, but NOT git commit
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* add .',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* reset -- tasks.md',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* reset -- PRD.md',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* diff --cached --name-only',
        expect.objectContaining({ cwd: testDir })
      );
      expect(execSync).not.toHaveBeenCalledWith(
        expect.stringContaining('commit'),
        expect.anything()
      );
      expect(execSync).toHaveBeenCalledWith(
        `git -c safe.directory=* worktree remove --force "${testDir}"`,
        expect.objectContaining({ cwd: sourceRepoDir })
      );
    });

    it('should archive files by overwriting existing files in the destination directory', async () => {
      await resetBoard('- [ ] Task 1');
      fs.rmSync(testDir, { recursive: true, force: true });

      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* worktree add')) {
          fs.mkdirSync(testDir, { recursive: true });
          fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD New Content');
          fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1 New Content');
        }
        return Buffer.from('');
      });

      // Pre-create the destination files with old content
      const destDir = path.join(sourceRepoDir, '.afk-coder', 'tasks', 'wt-test-overwrite');
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'tasks.md'), '- [x] Old Tasks');
      fs.writeFileSync(path.join(destDir, 'PRD.md'), '# Old PRD');

      await workflowManager.startWorkflow('wt-test-overwrite', testDir, {
        isWorktree: true,
        sourceRepo: sourceRepoDir,
        branch: 'workflow/wt-test-overwrite'
      });

      const executor = (workflowManager as any).workflows.get('wt-test-overwrite');
      executor.status = 'Done';

      (execSync as jest.Mock).mockClear();

      await workflowManager.removeWorkflow('wt-test-overwrite', undefined, true);

      // Verify that the destination files were overwritten with new content
      const archivedTasksPath = path.join(destDir, 'tasks.md');
      const archivedPrdPath = path.join(destDir, 'PRD.md');
      expect(fs.readFileSync(archivedTasksPath, 'utf8')).toContain('- [ ] Task 1 New Content');
      expect(fs.readFileSync(archivedPrdPath, 'utf8')).toContain('# PRD New Content');
    });

    it('should handle missing tasks.md and PRD.md gracefully during removal', async () => {
      await resetBoard('- [ ] Task 1');
      fs.rmSync(testDir, { recursive: true, force: true });

      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd.includes('git -c safe.directory=* worktree add')) {
          fs.mkdirSync(testDir, { recursive: true });
          // Note: we create them initially to pass startWorkflow validation, but we will delete them before removal
          fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD');
          fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
        }
        return Buffer.from('');
      });

      await workflowManager.startWorkflow('wt-test-missing-files', testDir, {
        isWorktree: true,
        sourceRepo: sourceRepoDir,
        branch: 'workflow/wt-test-missing-files'
      });

      const executor = (workflowManager as any).workflows.get('wt-test-missing-files');
      executor.status = 'Done';

      // Delete the files from the worktree directory before removal
      fs.rmSync(path.join(testDir, 'tasks.md'), { force: true });
      fs.rmSync(path.join(testDir, 'PRD.md'), { force: true });

      (execSync as jest.Mock).mockClear();

      // Verify it does not throw
      await expect(workflowManager.removeWorkflow('wt-test-missing-files', undefined, true)).resolves.not.toThrow();

      // Verify archiving directory is empty or doesn't have the files
      const destDir = path.join(sourceRepoDir, '.afk-coder', 'tasks', 'wt-test-missing-files');
      expect(fs.existsSync(path.join(destDir, 'tasks.md'))).toBe(false);
      expect(fs.existsSync(path.join(destDir, 'PRD.md'))).toBe(false);
    });

    it('should remove a standard (non-worktree) workflow without git commands', async () => {
      await resetBoard('- [ ] Task 1');

      mockRuntime.nextResult = {
        exitCode: 0,
        logs: 'Success'
      };

      await workflowManager.startWorkflow('standard-test', testDir);

      // Mark manually as Done so we can remove
      const executor = (workflowManager as any).workflows.get('standard-test');
      executor.status = 'Done';

      (execSync as jest.Mock).mockClear();

      const milestones: any[] = [];
      await workflowManager.removeWorkflow('standard-test', (m) => milestones.push(m));

      // Assert it was deleted from maps
      expect(workflowManager.getWorkflow('standard-test')).toBeUndefined();

      // Assert milestones were emitted
      expect(milestones).toContainEqual(
        expect.objectContaining({ status: 'starting' })
      );
      expect(milestones).toContainEqual(
        expect.objectContaining({ status: 'completed' })
      );

      // Assert no git commands were executed
      expect(execSync).not.toHaveBeenCalled();
    });

    it('should untrack but preserve worktree directory when deleteDir is false', async () => {
      await resetBoard('- [ ] Task 1');

      (execSync as jest.Mock).mockImplementationOnce(() => Buffer.from(''));
      await workflowManager.startWorkflow('wt-test-untrack', testDir, {
        isWorktree: true,
        sourceRepo: '/mock/repo',
        branch: 'workflow/wt-test-untrack'
      });

      const executor = (workflowManager as any).workflows.get('wt-test-untrack');
      executor.status = 'Done';

      (execSync as jest.Mock).mockClear();
      
      // Write dummy .git pointer file
      const gitPointerPath = path.join(testDir, '.git');
      fs.writeFileSync(gitPointerPath, 'gitdir: ...');

      await workflowManager.removeWorkflow('wt-test-untrack', undefined, false);

      // Verify .git file removal and prune worktrees called
      expect(fs.existsSync(gitPointerPath)).toBe(false);
      expect(execSync).toHaveBeenCalledWith(
        'git -c safe.directory=* worktree prune',
        expect.objectContaining({ cwd: '/mock/repo' })
      );
      expect(execSync).not.toHaveBeenCalledWith(
        expect.stringContaining('worktree remove'),
        expect.anything()
      );
    });

    it('should delete standard directory when deleteDir is true', async () => {
      await resetBoard('- [ ] Task 1');

      // Create a dummy workflow directory
      const standardDir = path.resolve('./test-standard-workflow');
      if (fs.existsSync(standardDir)) {
        fs.rmSync(standardDir, { recursive: true, force: true });
      }
      fs.mkdirSync(standardDir);
      fs.writeFileSync(path.join(standardDir, 'PRD.md'), '# PRD');
      fs.writeFileSync(path.join(standardDir, 'tasks.md'), '- [ ] Task 1');

      await workflowManager.startWorkflow('standard-delete-test', standardDir);

      const executor = (workflowManager as any).workflows.get('standard-delete-test');
      executor.status = 'Done';

      expect(fs.existsSync(standardDir)).toBe(true);

      await workflowManager.removeWorkflow('standard-delete-test', undefined, true);

      // Verify directory was deleted
      expect(fs.existsSync(standardDir)).toBe(false);
    });

    it('should NOT delete standard directory when deleteDir is false', async () => {
      await resetBoard('- [ ] Task 1');

      const standardDir = path.resolve('./test-standard-workflow-keep');
      if (fs.existsSync(standardDir)) {
        fs.rmSync(standardDir, { recursive: true, force: true });
      }
      fs.mkdirSync(standardDir);
      fs.writeFileSync(path.join(standardDir, 'PRD.md'), '# PRD');
      fs.writeFileSync(path.join(standardDir, 'tasks.md'), '- [ ] Task 1');

      await workflowManager.startWorkflow('standard-keep-test', standardDir);

      const executor = (workflowManager as any).workflows.get('standard-keep-test');
      executor.status = 'Done';

      expect(fs.existsSync(standardDir)).toBe(true);

      await workflowManager.removeWorkflow('standard-keep-test', undefined, false);

      // Verify directory was NOT deleted
      expect(fs.existsSync(standardDir)).toBe(true);

      // Cleanup
      fs.rmSync(standardDir, { recursive: true, force: true });
    });

    it('should throw error and emit failed milestone when git worktree removal fails', async () => {
      const mockGit = {
        removeWorktree: jest.fn().mockImplementation(() => {
          throw new Error('Git remove worktree failed');
        }),
      } as any;

      const originalFactory = (workflowManager as any).gitClientFactory;
      (workflowManager as any).gitClientFactory = () => mockGit;

      await resetBoard('- [ ] Task 1');
      await workflowManager.startWorkflow('wt-delete-err', testDir, {
        isWorktree: true,
        sourceRepo: sourceRepoDir,
        branch: 'workflow/wt-delete-err'
      });

      const executor = (workflowManager as any).workflows.get('wt-delete-err');
      executor.status = 'Done';

      const milestones: MilestoneEvent[] = [];
      await expect(
        workflowManager.removeWorkflow('wt-delete-err', (m) => milestones.push(m), true)
      ).rejects.toThrow('Git remove worktree failed');

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.FAILED,
        message: 'Failed to remove/untrack git worktree: Git remove worktree failed'
      }));

      (workflowManager as any).gitClientFactory = originalFactory;
    });

    it('should throw error and emit failed milestone when directory deletion fails', async () => {
      await resetBoard('- [ ] Task 1');
      const standardDir = path.resolve('./test-standard-workflow-err');
      if (!fs.existsSync(standardDir)) fs.mkdirSync(standardDir);
      fs.writeFileSync(path.join(standardDir, 'PRD.md'), '# PRD');
      fs.writeFileSync(path.join(standardDir, 'tasks.md'), '- [ ] Task 1');
      
      await workflowManager.startWorkflow('standard-delete-err', standardDir);
      const executor = (workflowManager as any).workflows.get('standard-delete-err');
      executor.status = 'Done';

      jest.spyOn((workflowManager as any).fileSystem, 'deleteDirectory').mockImplementation(() => {
        throw new Error('Deletion failed');
      });

      const milestones: MilestoneEvent[] = [];
      await expect(
        workflowManager.removeWorkflow('standard-delete-err', (m) => milestones.push(m), true)
      ).rejects.toThrow('Deletion failed');

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.FAILED,
        message: 'Failed to delete directory: Deletion failed'
      }));

      jest.restoreAllMocks();
      fs.rmSync(standardDir, { recursive: true, force: true });
    });
  });

  describe('QA Phase', () => {
    const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

    it('should transition to QA Phase and complete if no new tasks are added', async () => {
      await resetBoard('- [ ] Task 1');

      // Coder run succeeds and completes Task 1
      mockRuntime.nextResult = { exitCode: 0, logs: 'Code Done' };
      
      const originalRun = mockRuntime.run.bind(mockRuntime);
      mockRuntime.run = async (prompt, dir, configDir) => {
        const handle = await originalRun(prompt, dir, configDir);
        const originalWait = handle.wait.bind(handle);
        handle.wait = async () => {
          if (prompt.includes('Open tasks.md and identify')) {
            await inMemoryStorage.write('- [x] Task 1');
            fs.writeFileSync(path.join(dir, 'tasks.md'), '- [x] Task 1');
          }
          return await originalWait();
        };
        return handle;
      };

      await workflowManager.startWorkflow('qa-success', testDir);

      let attempts = 0;
      let workflow = workflowManager.getWorkflow('qa-success');
      while (workflow && workflow.status !== 'Done' && attempts < 100) {
        await jest.advanceTimersByTimeAsync(5000);
        await flushPromises();
        workflow = workflowManager.getWorkflow('qa-success');
        attempts++;
      }

      workflow = workflowManager.getWorkflow('qa-success')!;
      expect(workflow.status).toBe('Done');
      expect(workflow.phase).toBe('QA');
      expect(workflow.qaCycles).toBe(0);
    });

    it('should transition back to Coding if QA adds tasks with valid PRD tags', async () => {
      await resetBoard('- [ ] Task 1');
      mockRuntime.nextResult = { exitCode: 0, logs: 'Done' };

      const originalRun = mockRuntime.run.bind(mockRuntime);
      mockRuntime.run = async (prompt, dir, configDir) => {
        const handle = await originalRun(prompt, dir, configDir);
        const originalWait = handle.wait.bind(handle);
        handle.wait = async () => {
          if (prompt.includes('Open tasks.md and identify')) {
            await inMemoryStorage.write('- [x] Task 1');
            fs.writeFileSync(path.join(dir, 'tasks.md'), '- [x] Task 1');
          } else if (prompt.includes('Read the PRD.md file and examine the codebase')) {
            await inMemoryStorage.write('- [x] Task 1\n- [ ] QA Bug [PRD: Section 1]');
            fs.writeFileSync(path.join(dir, 'tasks.md'), '- [x] Task 1\n- [ ] QA Bug [PRD: Section 1]');
          }
          return await originalWait();
        };
        return handle;
      };

      await workflowManager.startWorkflow('qa-retry', testDir);

      let workflow = workflowManager.getWorkflow('qa-retry');
      let attempts = 0;
      while (workflow && workflow.qaCycles === 0 && attempts < 100) {
        await jest.advanceTimersByTimeAsync(5000);
        await flushPromises();
        workflow = workflowManager.getWorkflow('qa-retry');
        attempts++;
      }

      workflow = workflowManager.getWorkflow('qa-retry')!;
      expect(workflow.phase).toBe('Coding');
      expect(workflow.qaCycles).toBe(1);

      await workflowManager.killWorkflow('qa-retry');
    });

    it('should fail with QA Task Validation Error if a new task lacks PRD tag', async () => {
      await resetBoard('- [ ] Task 1');
      mockRuntime.nextResult = { exitCode: 0, logs: 'Done' };

      const originalRun = mockRuntime.run.bind(mockRuntime);
      mockRuntime.run = async (prompt, dir, configDir) => {
        const handle = await originalRun(prompt, dir, configDir);
        const originalWait = handle.wait.bind(handle);
        handle.wait = async () => {
          if (prompt.includes('Open tasks.md and identify')) {
            await inMemoryStorage.write('- [x] Task 1');
            fs.writeFileSync(path.join(dir, 'tasks.md'), '- [x] Task 1');
          } else if (prompt.includes('Read the PRD.md file and examine the codebase')) {
            await inMemoryStorage.write('- [x] Task 1\n- [ ] Untraced QA Bug');
            fs.writeFileSync(path.join(dir, 'tasks.md'), '- [x] Task 1\n- [ ] Untraced QA Bug');
          }
          return await originalWait();
        };
        return handle;
      };

      await workflowManager.startWorkflow('qa-val-fail', testDir);

      let workflow = workflowManager.getWorkflow('qa-val-fail');
      let attempts = 0;
      while (workflow && !workflow.status.startsWith('Failed') && attempts < 100) {
        await jest.advanceTimersByTimeAsync(5000);
        await flushPromises();
        workflow = workflowManager.getWorkflow('qa-val-fail');
        attempts++;
      }

      workflow = workflowManager.getWorkflow('qa-val-fail')!;
      expect(workflow.status).toBe('Failed: QA Task Validation Error');
      await workflowManager.killWorkflow('qa-val-fail');
    });

    it('should fail with Max QA Cycles Exceeded if loops exceed limit', async () => {
      await resetBoard('- [ ] Task 1');
      mockRuntime.nextResult = { exitCode: 0, logs: 'Done' };

      await workflowManager.startWorkflow('qa-max-limit', testDir);
      
      const executor = (workflowManager as any).workflows.get('qa-max-limit');
      executor.qaCycles = 3;

      const originalRun = mockRuntime.run.bind(mockRuntime);
      mockRuntime.run = async (prompt, dir, configDir) => {
        const handle = await originalRun(prompt, dir, configDir);
        const originalWait = handle.wait.bind(handle);
        handle.wait = async () => {
          if (prompt.includes('Open tasks.md and identify')) {
            await inMemoryStorage.write('- [x] Task 1');
            fs.writeFileSync(path.join(dir, 'tasks.md'), '- [x] Task 1');
          }
          return await originalWait();
        };
        return handle;
      };

      let workflow = workflowManager.getWorkflow('qa-max-limit');
      let attempts = 0;
      while (workflow && !workflow.status.startsWith('Failed') && attempts < 100) {
        await jest.advanceTimersByTimeAsync(5000);
        await flushPromises();
        workflow = workflowManager.getWorkflow('qa-max-limit');
        attempts++;
      }

      workflow = workflowManager.getWorkflow('qa-max-limit')!;
      expect(workflow.status).toBe('Failed: Max QA Cycles Exceeded');
      await workflowManager.killWorkflow('qa-max-limit');
    });
  });

  describe('Agent Factory', () => {
    it('should pass the agent name to the factory', async () => {
      const factory = jest.fn().mockImplementation(() => new Agent(mockRuntime, new OutcomeAnalyzer(), new GeminiAdapter()));
      workflowManager = new WorkflowManager(factory, () => mockTaskBoard);

      await workflowManager.startWorkflow('agent-test', testDir, { agent: 'aider' });

      expect(factory).toHaveBeenCalledWith('aider');
      await workflowManager.killWorkflow('agent-test');
    });

    it('should pass undefined to the factory if no agent is specified', async () => {
      const factory = jest.fn().mockImplementation(() => new Agent(mockRuntime, new OutcomeAnalyzer(), new GeminiAdapter()));
      workflowManager = new WorkflowManager(factory, () => mockTaskBoard);

      await workflowManager.startWorkflow('agent-test-none', testDir);

      expect(factory).toHaveBeenCalledWith(undefined);
      await workflowManager.killWorkflow('agent-test-none');
    });
  });

  describe('Git Client Mocking Integration', () => {
    it('should use MockGitClient when provided via GitClientFactory', async () => {
      const mockSrcRepo = path.resolve('./mock-source-repo');
      if (fs.existsSync(mockSrcRepo)) {
        fs.rmSync(mockSrcRepo, { recursive: true, force: true });
      }
      fs.mkdirSync(mockSrcRepo, { recursive: true });
      fs.writeFileSync(path.join(mockSrcRepo, 'PRD.md'), '# PRD');
      fs.writeFileSync(path.join(mockSrcRepo, 'tasks.md'), '- [ ] Task 1');

      const mockGit = new MockGitClient(testDir);
      mockGit.branches.add('workflow/mock-branch');
      mockGit.topLevel = mockSrcRepo;
      mockGit.createWorktree = (targetPath, branch) => {
        mockGit.worktrees.set(targetPath, branch);
        fs.mkdirSync(targetPath, { recursive: true });
      };
      mockGit.addWorktree = (targetPath, branch) => {
        mockGit.worktrees.set(targetPath, branch);
        fs.mkdirSync(targetPath, { recursive: true });
      };

      const gitClientFactory = jest.fn().mockImplementation(() => mockGit);
      workflowManager = new WorkflowManager(
        () => new Agent(mockRuntime, new OutcomeAnalyzer(), new GeminiAdapter()),
        () => mockTaskBoard,
        undefined,
        gitClientFactory
      );

      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }

      await workflowManager.startWorkflow('mock-git-workflow', testDir, {
        isWorktree: true,
        sourceRepo: mockSrcRepo,
        branch: 'workflow/mock-branch'
      });

      expect(gitClientFactory).toHaveBeenCalledWith(mockSrcRepo);
      expect(gitClientFactory).toHaveBeenCalledWith(testDir);

      expect(mockGit.worktrees.get(testDir)).toBe('workflow/mock-branch');

      await workflowManager.killWorkflow('mock-git-workflow');

      if (fs.existsSync(mockSrcRepo)) {
        fs.rmSync(mockSrcRepo, { recursive: true, force: true });
      }
    });
  });

  describe('Log Filtering', () => {
    it('should filter logs by workflow name, supporting tail and offset options', async () => {
      await resetBoard('- [ ] Task 1');
      await workflowManager.startWorkflow('wf-filter-1', testDir);

      const logFile = path.join(testStateDir, 'afk-coder', 'logs', 'wf-filter-1.json.log');
      const mockLogEntries = [
        JSON.stringify({ workflow: 'wf-filter-1', message: 'log 1' }),
        JSON.stringify({ workflow: 'wf-filter-2', message: 'log 2' }),
        JSON.stringify({ workflow: 'wf-filter-1', message: 'log 3' }),
        'non-json-line-wf-filter-1',
        'non-json-line-wf-filter-2',
        JSON.stringify({ workflow: 'wf-filter-1', message: 'log 4' }),
      ].join('\n') + '\n';

      fs.writeFileSync(logFile, mockLogEntries);

      // Verify basic filtering
      const logs = workflowManager.getLogs('wf-filter-1');
      expect(logs.content).toContain('log 1');
      expect(logs.content).toContain('log 3');
      expect(logs.content).toContain('non-json-line-wf-filter-1');
      expect(logs.content).toContain('log 4');
      expect(logs.content).not.toContain('log 2');
      expect(logs.content).not.toContain('non-json-line-wf-filter-2');

      // Verify tail option
      const tailedLogs = workflowManager.getLogs('wf-filter-1', { tail: 2 });
      const tailedLines = tailedLogs.content.trim().split('\n');
      expect(tailedLines.length).toBe(2);
      expect(tailedLines[0]).toContain('non-json-line-wf-filter-1');
      expect(tailedLines[1]).toContain('log 4');

      // Verify offset option
      // Write entry 1 and 2
      const initialLogs = [
        JSON.stringify({ workflow: 'wf-filter-1', message: 'init 1' }),
        JSON.stringify({ workflow: 'wf-filter-2', message: 'init 2' })
      ].join('\n') + '\n';
      fs.writeFileSync(logFile, initialLogs);
      const initialOffset = fs.statSync(logFile).size;

      // Append new entries
      const appendLogs = [
        JSON.stringify({ workflow: 'wf-filter-1', message: 'append 3' }),
        JSON.stringify({ workflow: 'wf-filter-2', message: 'append 4' })
      ].join('\n') + '\n';
      fs.appendFileSync(logFile, appendLogs);

      const offsetLogs = workflowManager.getLogs('wf-filter-1', { offset: initialOffset });
      expect(offsetLogs.content).toContain('append 3');
      expect(offsetLogs.content).not.toContain('append 4');
      expect(offsetLogs.content).not.toContain('init 1');
      expect(offsetLogs.content).not.toContain('init 2');

      await workflowManager.killWorkflow('wf-filter-1');
    });

    it('should retrieve consolidated logs across all workflow files when workflow name is omitted', async () => {
      const logsDir = path.join(testStateDir, 'afk-coder', 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const wf1LogFile = path.join(logsDir, 'wf-1.json.log');
      const wf2LogFile = path.join(logsDir, 'wf-2.json.log');
      const daemonLogFile = path.join(logsDir, 'daemon.json.log');

      const wf1Entries = [
        JSON.stringify({ timestamp: '2026-05-28T10:00:00.000Z', workflow: 'wf-1', message: 'wf1 first' }),
        JSON.stringify({ timestamp: '2026-05-28T10:02:00.000Z', workflow: 'wf-1', message: 'wf1 second' })
      ].join('\n') + '\n';

      const wf2Entries = [
        JSON.stringify({ timestamp: '2026-05-28T10:01:00.000Z', workflow: 'wf-2', message: 'wf2 first' })
      ].join('\n') + '\n';

      const daemonEntries = [
        JSON.stringify({ timestamp: '2026-05-28T09:59:00.000Z', service: 'afk-coder-daemon', message: 'daemon log' })
      ].join('\n') + '\n';

      fs.writeFileSync(wf1LogFile, wf1Entries);
      fs.writeFileSync(wf2LogFile, wf2Entries);
      fs.writeFileSync(daemonLogFile, daemonEntries);

      // Fetching consolidated logs (no name, daemon: false)
      const consolidated = workflowManager.getLogs(undefined);
      expect(consolidated.content).toContain('wf1 first');
      expect(consolidated.content).toContain('wf2 first');
      expect(consolidated.content).toContain('wf1 second');
      expect(consolidated.content).not.toContain('daemon log');

      // Verify they are sorted chronologically
      const lines = consolidated.content.trim().split('\n');
      expect(lines.length).toBe(3);
      expect(JSON.parse(lines[0]).message).toBe('wf1 first');
      expect(JSON.parse(lines[1]).message).toBe('wf2 first');
      expect(JSON.parse(lines[2]).message).toBe('wf1 second');

      // Fetching daemon logs explicitly
      const daemonLogs = workflowManager.getLogs(undefined, { daemon: true });
      expect(daemonLogs.content).toContain('daemon log');
      expect(daemonLogs.content).not.toContain('wf1 first');
    });
  });

  describe('Log Rotation and Retention Limits', () => {
    it('should initialize Winston file transport with configured logRotation limits', async () => {
      const testConfigDir = path.resolve('./test-config-wt-commit');
      if (fs.existsSync(testConfigDir)) {
        fs.rmSync(testConfigDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(testConfigDir, 'config.json'),
        JSON.stringify({
          daemon: {
            logRotation: {
              maxSize: 12345,
              maxFiles: 42
            }
          }
        })
      );

      const logger = (workflowManager as any).getOrCreateLogger('test-rotate-1', testDir, testConfigDir);
      const fileTransport = logger.transports.find((t: any) => t instanceof winston.transports.File);

      expect(fileTransport).toBeDefined();
      expect(fileTransport.maxsize).toBe(12345);
      expect(fileTransport.maxFiles).toBe(42);
      expect(fileTransport.tailable).toBe(true);

      fs.rmSync(testConfigDir, { recursive: true, force: true });
    });

    it('should initialize Winston file transport with default limits when not configured', async () => {
      const testConfigDir = path.resolve('./test-config-wt-commit-default');
      if (fs.existsSync(testConfigDir)) {
        fs.rmSync(testConfigDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(testConfigDir, 'config.json'),
        JSON.stringify({
          daemon: {}
        })
      );

      const logger = (workflowManager as any).getOrCreateLogger('test-rotate-2', testDir, testConfigDir);
      const fileTransport = logger.transports.find((t: any) => t instanceof winston.transports.File);

      expect(fileTransport).toBeDefined();
      expect(fileTransport.maxsize).toBe(10 * 1024 * 1024); // 10MB default
      expect(fileTransport.maxFiles).toBe(5); // 5 files default

      fs.rmSync(testConfigDir, { recursive: true, force: true });
    });

    it('should fallback to defaults when invalid/negative logRotation values are configured', async () => {
      const testConfigDir = path.resolve('./test-config-wt-commit-invalid');
      if (fs.existsSync(testConfigDir)) {
        fs.rmSync(testConfigDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(testConfigDir, 'config.json'),
        JSON.stringify({
          daemon: {
            logRotation: {
              maxSize: -500, // negative size
              maxFiles: "invalid-string" // invalid files
            }
          }
        })
      );

      const logger = (workflowManager as any).getOrCreateLogger('test-rotate-3', testDir, testConfigDir);
      const fileTransport = logger.transports.find((t: any) => t instanceof winston.transports.File);

      expect(fileTransport).toBeDefined();
      expect(fileTransport.maxsize).toBe(10 * 1024 * 1024); // 10MB fallback
      expect(fileTransport.maxFiles).toBe(5); // 5 files fallback

      fs.rmSync(testConfigDir, { recursive: true, force: true });
    });

    it('should create logs directory and store the log file in the resolved directory', async () => {
      const logger = (workflowManager as any).getOrCreateLogger('test-rotate-4', testDir);
      const fileTransport = logger.transports.find((t: any) => t instanceof winston.transports.File);

      expect(fileTransport).toBeDefined();
      const expectedLogDir = path.join(testStateDir, 'afk-coder', 'logs');
      const expectedLogFile = path.join(expectedLogDir, 'test-rotate-4.json.log');
      
      expect(fs.existsSync(expectedLogDir)).toBe(true);
      expect(fileTransport.dirname).toBe(expectedLogDir);
      expect(fileTransport.filename).toBe('test-rotate-4.json.log');
    });

    it('should initialize Winston logger with the configured logLevel from daemon settings', async () => {
      const testConfigDir = path.resolve('./test-config-log-level');
      if (fs.existsSync(testConfigDir)) {
        fs.rmSync(testConfigDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(testConfigDir, 'config.json'),
        JSON.stringify({
          daemon: {
            logLevel: 'debug'
          }
        })
      );

      const logger = (workflowManager as any).getOrCreateLogger('test-log-level-wf', testDir, testConfigDir);
      expect(logger.level).toBe('debug');

      fs.rmSync(testConfigDir, { recursive: true, force: true });
    });
  });

  describe('Real-time Log Streaming integration', () => {
    it('should emit log events from WorkflowManager when a logger receives a log message', (done) => {
      const logger = (workflowManager as any).getOrCreateLogger('test-stream-wf', testDir);
      
      workflowManager.once('log', (name: string, info: any) => {
        expect(name).toBe('test-stream-wf');
        expect(info.message).toBe('Test real-time event log message');
        done();
      });

      logger.info('Test real-time event log message');
    });

    it('should return the correct executor with getExecutor', async () => {
      const tasksFile = path.join(testDir, 'tasks.md');
      const prdFile = path.join(testDir, 'PRD.md');
      fs.writeFileSync(tasksFile, '- [ ] Task 1');
      fs.writeFileSync(prdFile, '# PRD');

      mockRuntime.nextResult = { exitCode: 0, logs: 'Done' };

      const workflow = await workflowManager.startWorkflow('test-exec-get', testDir);
      const executor = workflowManager.getExecutor('test-exec-get');
      expect(executor).toBeDefined();
      expect(executor?.name).toBe('test-exec-get');
      
      await workflowManager.killWorkflow('test-exec-get');
    });

    it('should invoke onFinished callback on WorkflowExecutor when execution finishes', async () => {
      jest.useRealTimers();
      try {
        const tasksFile = path.join(testDir, 'tasks.md');
        const prdFile = path.join(testDir, 'PRD.md');
        fs.writeFileSync(tasksFile, '- [ ] Task 1');
        fs.writeFileSync(prdFile, '# PRD');

        mockRuntime.nextResult = { exitCode: 0, logs: 'Done' };

        const workflow = await workflowManager.startWorkflow('test-finish-callback', testDir);
        const executor = workflowManager.getExecutor('test-finish-callback');
        expect(executor).toBeDefined();

        let finishedInvoked = false;
        const unsubscribe = executor!.onFinished(() => {
          finishedInvoked = true;
        });

        await workflowManager.killWorkflow('test-finish-callback');

        await new Promise(resolve => setTimeout(resolve, 50));
        expect(finishedInvoked).toBe(true);

        unsubscribe();
      } finally {
        jest.useFakeTimers();
      }
    });
  });

  describe('init', () => {
    const TEST_INIT_DIR = path.resolve('./test-workflow-manager-init');

    beforeEach(() => {
      jest.useRealTimers();
      if (fs.existsSync(TEST_INIT_DIR)) {
        fs.rmSync(TEST_INIT_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(TEST_INIT_DIR);
    });

    afterEach(() => {
      jest.useFakeTimers();
      if (fs.existsSync(TEST_INIT_DIR)) {
        fs.rmSync(TEST_INIT_DIR, { recursive: true, force: true });
      }
    });

    it('should call agent.generateTasks and report milestones', async () => {
      fs.writeFileSync(path.join(TEST_INIT_DIR, 'PRD.md'), '# PRD');
      mockRuntime.nextResult = {
        exitCode: 0,
        logs: '- [ ] Task 1'
      };

      const milestones: any[] = [];
      const onMilestone = (m: any) => milestones.push(m);

      const agentFactory = () => new Agent(mockRuntime, new OutcomeAnalyzer(), new GeminiAdapter());
      const taskBoardFactory = (p: string) => new TaskBoard(new FileSystemTaskStorage(p), new TaskValidator());
      const initWorkflowManager = new WorkflowManager(agentFactory, taskBoardFactory);

      const result = await initWorkflowManager.init({
        dir: TEST_INIT_DIR,
        prd: 'PRD.md'
      }, onMilestone);

      expect(result.success).toBe(true);
      expect(milestones.length).toBeGreaterThan(0);
      expect(milestones[0].status).toBe('starting');
      expect(milestones.some(m => m.status === 'completed')).toBe(true);
      expect(fs.existsSync(path.join(TEST_INIT_DIR, 'tasks.md'))).toBe(true);
    });
  });

  describe('WorkflowManager Status Updates', () => {
    const statusTestDir = path.resolve('./test-status-unit');
    const statusTestStateDir = path.resolve('./test-status-xdg-state');
    let localWorkflowManager: WorkflowManager;
    let localMockRuntime: MockRuntime;
    let localOriginalXdgStateHome: string | undefined;

    beforeEach(() => {
      jest.useRealTimers();
      if (fs.existsSync(statusTestDir)) {
        fs.rmSync(statusTestDir, { recursive: true, force: true });
      }
      if (fs.existsSync(statusTestStateDir)) {
        fs.rmSync(statusTestStateDir, { recursive: true, force: true });
      }
      fs.mkdirSync(statusTestDir);
      fs.mkdirSync(statusTestStateDir);

      localOriginalXdgStateHome = process.env.XDG_STATE_HOME;
      process.env.XDG_STATE_HOME = statusTestStateDir;

      fs.writeFileSync(path.join(statusTestDir, 'PRD.md'), '# Dummy PRD');
      fs.writeFileSync(path.join(statusTestDir, 'tasks.md'), '- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3\n- [ ] Task 4\n- [ ] Task 5\n- [ ] Task 6');

      localMockRuntime = new MockRuntime();
      localMockRuntime.runDelay = 100;
      const testAnalyzer = new OutcomeAnalyzer(3, 0);
      localWorkflowManager = new WorkflowManager(
        () => new Agent(localMockRuntime, testAnalyzer, new GeminiAdapter()),
        undefined,
        testAnalyzer
      );
    });

    afterEach(async () => {
      jest.useFakeTimers();
      process.env.XDG_STATE_HOME = localOriginalXdgStateHome;
      if (localWorkflowManager) {
        const workflows = localWorkflowManager.listWorkflows();
        for (const wf of workflows) {
          try {
            await localWorkflowManager.killWorkflow(wf.name);
          } catch {}
        }
      }
      if (fs.existsSync(statusTestDir)) {
        fs.rmSync(statusTestDir, { recursive: true, force: true });
      }
      if (fs.existsSync(statusTestStateDir)) {
        fs.rmSync(statusTestStateDir, { recursive: true, force: true });
      }
    });

    it('should initialize and update status fields correctly', async () => {
      let taskCount = 0;
      
      const originalRun = localMockRuntime.run.bind(localMockRuntime);
      localMockRuntime.run = async (prompt, dir, configDir) => {
        taskCount++;
        const currentTaskCount = taskCount;
        const handle = await originalRun(prompt, dir, configDir);
        const originalWait = handle.wait.bind(handle);
        handle.wait = async () => {
          // Mark task as done in tasks.md
          const content = fs.readFileSync(path.join(statusTestDir, 'tasks.md'), 'utf-8');
          const lines = content.split('\n');
          const taskIndex = lines.findIndex(l => l.includes(`Task ${currentTaskCount}`) && l.includes('[ ]'));
          if (taskIndex !== -1) {
            lines[taskIndex] = lines[taskIndex].replace('[ ]', '[x]');
            fs.writeFileSync(path.join(statusTestDir, 'tasks.md'), lines.join('\n'));
          }
          return { 
            exitCode: 0, 
            logs: `Task ${currentTaskCount} done. Token usage: 10 prompt, 5 completion` 
          };
        };
        return handle;
      };

      await localWorkflowManager.startWorkflow('test-wf', statusTestDir);
      
      let workflow = localWorkflowManager.getWorkflow('test-wf')!;
      // Initial check
      expect(workflow.tokenUsage).toEqual({ input: 0, output: 0, total: 0 });
      expect(workflow.recentTasks).toEqual([]);
      
      // Wait for first task to start
      workflow = localWorkflowManager.getWorkflow('test-wf')!;
      while (workflow && !workflow.currentTask && workflow.status !== 'Done') {
        await new Promise(resolve => setTimeout(resolve, 10));
        workflow = localWorkflowManager.getWorkflow('test-wf')!;
      }
      expect(workflow.currentTask).toBe('Task 1');

      // Wait for tasks to complete
      let attempts = 0;
      while (workflow && workflow.status !== 'Done' && attempts < 200) {
        await new Promise(resolve => setTimeout(resolve, 500));
        workflow = localWorkflowManager.getWorkflow('test-wf')!;
        attempts++;
      }

      workflow = localWorkflowManager.getWorkflow('test-wf')!;
      if (workflow.status !== 'Done') {
        const logFile = path.join(statusTestStateDir, 'afk-coder', 'logs', 'test-wf.json.log');
        if (fs.existsSync(logFile)) {
          console.log('Workflow Logs on Failure:');
          console.log(fs.readFileSync(logFile, 'utf-8'));
        }
      }

      expect(workflow.status).toBe('Done');
      expect(workflow.tokenUsage).toEqual({ 
        input: 70, // 6 coding tasks * 10 + 1 QA loop * 10
        output: 35, // 6 coding tasks * 5 + 1 QA loop * 5
        total: 105 
      });
      
      // Recent tasks should be capped at 5 and in reverse order (newest first)
      expect(workflow.recentTasks).toHaveLength(5);
      expect(workflow.recentTasks[0]).toBe('Task 6');
      expect(workflow.recentTasks[4]).toBe('Task 2');
      expect(workflow.currentTask).toBeUndefined();
    }, 120000);
  });
});

