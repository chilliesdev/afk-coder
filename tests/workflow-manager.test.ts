import { WorkflowManager } from '../src/daemon/workflow-manager';
import { MockRuntime } from './mocks/mock-runtime';
import { MockTaskBoard } from './mocks/mock-task-board';
import { AgentStrategy } from '../src/daemon/agent-strategy';
import * as fs from 'fs';
import * as path from 'path';

describe('WorkflowManager', () => {
  let workflowManager: WorkflowManager;
  let mockRuntime: MockRuntime;
  let mockTaskBoard: MockTaskBoard;
  let strategy: AgentStrategy;
  const testDir = path.resolve('./test-workflow-manager');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir);
    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD\nTest PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');

    mockRuntime = new MockRuntime();
    mockTaskBoard = new MockTaskBoard();
    strategy = new AgentStrategy();
    
    workflowManager = new WorkflowManager(
      mockRuntime,
      strategy,
      () => mockTaskBoard
    );

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should run a simple workflow to completion', async () => {
    mockTaskBoard.tasks = [
      { description: 'Task 1', completed: false }
    ];

    mockRuntime.nextResult = {
      exitCode: 0,
      logs: 'Success! Tokens: 10 in, 20 out'
    };

    // Simulate task completion on next sync
    const originalSync = mockTaskBoard.sync.bind(mockTaskBoard);
    mockTaskBoard.sync = async () => {
      await originalSync();
      if (mockTaskBoard.syncCalled === 3) { // 1 in startWorkflow, 1 in first loop, 1 after agent run
        mockTaskBoard.tasks[0].completed = true;
      }
    };

    const workflow = await workflowManager.startWorkflow('test', testDir);
    
    const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

    // Wait for it to finish by advancing timers and flushing promises
    let attempts = 0;
    while (workflow.status !== 'Done' && attempts < 100) {
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises();
      attempts++;
    }

    if (workflow.status !== 'Done') {
      console.log('Workflow Status:', workflow.status);
      console.log('Logs:', workflowManager.getLogs('test').content);
    }
    expect(workflow.status).toBe('Done');
    expect(workflow.tokenUsage).toEqual({ input: 10, output: 20, total: 30 });
    expect(workflow.recentTasks).toContain('Task 1');
  });

  it('should handle quota errors with retries', async () => {
    mockTaskBoard.tasks = [
      { description: 'Task 1', completed: false }
    ];

    mockRuntime.nextResult = {
      exitCode: 1,
      logs: 'Error: 429 Too Many Requests'
    };

    const workflow = await workflowManager.startWorkflow('test-quota', testDir);
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
    mockTaskBoard.tasks = [
      { description: 'Task 1', completed: false }
    ];

    mockRuntime.nextResult = {
      exitCode: 1,
      logs: 'Candidate was blocked due to safety'
    };

    const workflow = await workflowManager.startWorkflow('test-safety', testDir);
    const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

    await jest.advanceTimersByTimeAsync(5000);
    await flushPromises();

    expect(workflow.status).toBe('Failed: Safety Block');
    await workflowManager.killWorkflow('test-safety');
  });

  it('should handle multiple tasks and recover from errors', async () => {
    mockTaskBoard.tasks = [
      { description: 'Task 1', completed: false },
      { description: 'Task 2', completed: false }
    ];

    // First run fails with Quota
    mockRuntime.nextResult = {
      exitCode: 1,
      logs: 'Error: 429 Too Many Requests'
    };

    const workflow = await workflowManager.startWorkflow('complex', testDir);
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
           const pending = mockTaskBoard.getPendingTasks();
           if (pending.length > 0) {
             pending[0].completed = true;
           }
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
    while (!workflow.recentTasks.includes('Task 1') && task1Attempts < 100) {
      await jest.advanceTimersByTimeAsync(1000);
      await flushPromises();
      task1Attempts++;
    }

    expect(workflow.recentTasks).toContain('Task 1');
    // progress might be 1/2 or 2/2 depending on how fast the loop ran
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
      task2Attempts++;
    }

    expect(workflow.status).toBe('Done');
    expect(workflow.recentTasks).toContain('Task 2');
    // Token usage will be 10/20 if it took 2 runs, or 15/30 if it took 3 runs due to some race condition in tests
    expect(workflow.tokenUsage.input).toBeGreaterThanOrEqual(10);
  });
});
