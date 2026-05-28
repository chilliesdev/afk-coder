import { WorkflowManager } from '../../../src/daemon/workflow-manager';
import * as fs from 'fs';
import * as path from 'path';
import { MockRuntime } from '../../helpers/mock-runtime';
import { Agent } from '../../../src/daemon/agent';
import { GeminiAdapter } from '../../../src/daemon/agent-gemini';
import { OutcomeAnalyzer } from '../../../src/daemon/agent-outcome';

describe('WorkflowManager Resilience', () => {
  let workflowManager: WorkflowManager;
  let mockRuntime: MockRuntime;
  const baseTestDir = path.resolve('./test-resilience');

  beforeEach(() => {
    if (fs.existsSync(baseTestDir)) {
      fs.rmSync(baseTestDir, { recursive: true, force: true });
    }
    fs.mkdirSync(baseTestDir);

    mockRuntime = new MockRuntime();
    workflowManager = new WorkflowManager(() => new Agent(mockRuntime, new OutcomeAnalyzer(), new GeminiAdapter()));
  });

  afterEach(() => {
    if (fs.existsSync(baseTestDir)) {
      fs.rmSync(baseTestDir, { recursive: true, force: true });
    }
  });

  it('should handle different token usage formats', async () => {
    const testDir = path.join(baseTestDir, 'tokens');
    fs.mkdirSync(testDir);
    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD\nTest PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');

    const logs = [
      'Usage: input: 100 prompt, output: 200 completion',
      '200 prompt tokens, 300 completion tokens',
      'Token usage: 50 prompt, 150 completion',
      'input: 10, output: 20',
      'tokens: 5 in, 15 out',
      'usage: { prompt_tokens: 12, completion_tokens: 34 }'
    ];
    const expected = [
      { input: 100, output: 200 },
      { input: 200, output: 300 },
      { input: 50, output: 150 },
      { input: 10, output: 20 },
      { input: 5, output: 15 },
      { input: 12, output: 34 }
    ];

    let currentLogIndex = 0;
    
    const originalRun = mockRuntime.run.bind(mockRuntime);
    mockRuntime.run = async (prompt, dir, configDir) => {
      const idx = currentLogIndex++;
      const handle = await originalRun(prompt, dir, configDir);
      const originalWait = handle.wait.bind(handle);
      handle.wait = async () => {
        // Only update tasks during Coding phase (first logs.length runs)
        if (idx < logs.length) {
          const tasks = [];
          for (let i = 0; i <= idx; i++) tasks.push(`- [x] Task ${i+1}`);
          if (idx < logs.length - 1) tasks.push(`- [ ] Task ${idx+2}`);
          fs.writeFileSync(path.join(testDir, 'tasks.md'), tasks.join('\n'));
        }
        
        return { exitCode: 0, logs: logs[idx] };
      };
      return handle;
    };

    jest.useFakeTimers();

    await workflowManager.startWorkflow('test-tokens', testDir);
    const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

    let attempts = 0;
    let workflow = workflowManager.getWorkflow('test-tokens');
    while (workflow && workflow.status !== 'Done' && workflow.status !== 'Failed' && attempts < 100) {
      await jest.advanceTimersByTimeAsync(5000);
      await flushPromises();
      workflow = workflowManager.getWorkflow('test-tokens');
      attempts++;
    }

    workflow = workflowManager.getWorkflow('test-tokens')!;
    expect(workflow.status).toBe('Done');
    
    jest.useRealTimers();

    let logOutput = workflowManager.getLogs('test-tokens');
    for (let attempt = 0; attempt < 20; attempt++) {
      const allFound = expected.every(exp =>
        logOutput.content.includes(`"input":${exp.input},"output":${exp.output}`)
      );
      if (allFound) break;
      await new Promise(resolve => setTimeout(resolve, 50));
      logOutput = workflowManager.getLogs('test-tokens');
    }

    for (const exp of expected) {
      expect(logOutput.content).toContain(`"input":${exp.input},"output":${exp.output}`);
    }
  }, 30000);

  it('should handle 429 Too Many Requests with longer wait', async () => {
    const testDir = path.join(baseTestDir, '429');
    fs.mkdirSync(testDir);
    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD\nTest PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');

    let callCount = 0;
    
    const originalRun = mockRuntime.run.bind(mockRuntime);
    mockRuntime.run = async (prompt, dir, configDir) => {
      callCount++;
      const currentCallCount = callCount;
      const handle = await originalRun(prompt, dir, configDir);
      const originalWait = handle.wait.bind(handle);
      handle.wait = async () => {
        if (currentCallCount === 1) {
          return { exitCode: 1, logs: 'Error: 429 Too Many Requests' };
        }
        fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [x] Task 1');
        return { exitCode: 0, logs: 'Success after retry' };
      };
      return handle;
    };

    jest.useFakeTimers();

    await workflowManager.startWorkflow('test-429', testDir);
    const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

    let attempts = 0;
    while (callCount === 0 && attempts < 100) {
        await jest.advanceTimersByTimeAsync(100);
        await flushPromises();
        attempts++;
    }
    
    expect(callCount).toBe(1);
    
    await jest.advanceTimersByTimeAsync(65000);
    await flushPromises();
    
    attempts = 0;
    while (callCount === 1 && attempts < 100) {
        await jest.advanceTimersByTimeAsync(100);
        await flushPromises();
        attempts++;
    }
    expect(callCount).toBe(3);

    attempts = 0;
    let workflow = workflowManager.getWorkflow('test-429');
    while (workflow && workflow.status !== 'Done' && attempts < 100) {
        await jest.advanceTimersByTimeAsync(5000);
        await flushPromises();
        workflow = workflowManager.getWorkflow('test-429');
        attempts++;
    }

    workflow = workflowManager.getWorkflow('test-429')!;
    expect(workflow.status).toBe('Done');
    
    jest.useRealTimers();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const logOutput = workflowManager.getLogs('test-429');
    expect(logOutput.content).toContain('Gemini API quota exceeded, waiting longer...');
  }, 20000);
});
