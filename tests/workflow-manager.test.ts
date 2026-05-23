import { WorkflowManager } from '../src/daemon/workflow-manager';
import { MockRuntime } from './mocks/mock-runtime';
import { TaskBoard } from '../src/daemon/task-board';
import { InMemoryTaskStorage } from '../src/daemon/task-storage';
import { Agent } from '../src/daemon/agent';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'node:child_process';
import { MockGitClient } from '../src/common/git';

jest.mock('node:child_process', () => ({
  execSync: jest.fn()
}));

describe('WorkflowManager', () => {
  let workflowManager: WorkflowManager;
  let mockRuntime: MockRuntime;
  let mockTaskBoard: TaskBoard;
  let inMemoryStorage: InMemoryTaskStorage;
  const testDir = path.resolve('./test-workflow-manager');

  const resetBoard = async (content: string) => {
    await inMemoryStorage.write(content);
    await mockTaskBoard.load();
  };

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir);
    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD\nTest PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
    (execSync as jest.Mock).mockClear();

    mockRuntime = new MockRuntime();
    inMemoryStorage = new InMemoryTaskStorage('- [ ] Task 1');
    mockTaskBoard = new TaskBoard(inMemoryStorage);
    
    workflowManager = new WorkflowManager(
      () => new Agent(mockRuntime),
      () => mockTaskBoard
    );

    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.useRealTimers();
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

      workflowManager.removeWorkflow('wt-test3');

      expect(execSync).toHaveBeenCalledWith(
        `git -c safe.directory=* worktree remove --force "${testDir}"`,
        expect.objectContaining({ cwd: '/mock/repo' })
      );
    });

    it('should copy PRD.md and tasks.md from sourceRepo if they exist and are missing in worktree', async () => {
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

      // Verify they were copied
      expect(fs.existsSync(path.join(testDir, 'PRD.md'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'tasks.md'))).toBe(true);
      expect(fs.readFileSync(path.join(testDir, 'PRD.md'), 'utf8')).toBe('# Source PRD');

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

      await workflowManager.startWorkflow('wt-test-commit', testDir, {
        isWorktree: true,
        sourceRepo: '/mock/repo',
        branch: 'workflow/wt-test-commit'
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
      const factory = jest.fn().mockImplementation(() => new Agent(mockRuntime));
      workflowManager = new WorkflowManager(factory, () => mockTaskBoard);

      await workflowManager.startWorkflow('agent-test', testDir, { agent: 'aider' });

      expect(factory).toHaveBeenCalledWith('aider');
      await workflowManager.killWorkflow('agent-test');
    });

    it('should pass undefined to the factory if no agent is specified', async () => {
      const factory = jest.fn().mockImplementation(() => new Agent(mockRuntime));
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
        () => new Agent(mockRuntime),
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
});
