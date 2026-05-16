import { WorkflowManager } from '../src/daemon/workflow-manager';
import * as fs from 'fs';
import * as path from 'path';
import { Sandbox } from '../src/sandbox';

jest.mock('../src/sandbox');

describe('WorkflowManager Resilience', () => {
  let workflowManager: WorkflowManager;
  const baseTestDir = path.resolve('./test-resilience');

  beforeEach(() => {
    if (fs.existsSync(baseTestDir)) {
      fs.rmSync(baseTestDir, { recursive: true, force: true });
    }
    fs.mkdirSync(baseTestDir);
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

    const mockSandbox = Sandbox as jest.MockedClass<typeof Sandbox>;
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
    
    const mockRunTask = jest.fn().mockImplementation(async () => {
      const idx = currentLogIndex++;
      return {
        pid: 123 + idx,
        prompt: 'mock prompt',
        wait: async () => {
          // Add another task so the loop continues
          const tasks = [];
          for (let i = 0; i <= idx; i++) tasks.push(`- [x] Task ${i+1}`);
          if (idx < logs.length - 1) tasks.push(`- [ ] Task ${idx+2}`);
          fs.writeFileSync(path.join(testDir, 'tasks.md'), tasks.join('\n'));
          
          return { exitCode: 0, logs: logs[idx] };
        },
        stop: async () => {}
      };
    });
    
    mockSandbox.mockImplementation(() => {
      return {
        runTask: mockRunTask
      } as any;
    });

    workflowManager = new WorkflowManager();
    jest.useFakeTimers();

    const workflow = workflowManager.startWorkflow('test-tokens', testDir);

    let attempts = 0;
    while (workflow.status !== 'Done' && workflow.status !== 'Failed' && attempts < 100) {
      await jest.advanceTimersByTimeAsync(5000);
      attempts++;
    }

    expect(workflow.status).toBe('Done');
    
    const logOutput = workflowManager.getLogs('test-tokens');
    for (const exp of expected) {
      expect(logOutput.content).toContain(`"input":${exp.input},"output":${exp.output}`);
    }
    
    jest.useRealTimers();
  }, 30000);

  it('should handle 429 Too Many Requests with longer wait', async () => {
    const testDir = path.join(baseTestDir, '429');
    fs.mkdirSync(testDir);
    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD\nTest PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');

    const mockSandbox = Sandbox as jest.MockedClass<typeof Sandbox>;
    let callCount = 0;
    
    const mockRunTask = jest.fn().mockImplementation(async () => {
      callCount++;
      return {
        pid: 429,
        prompt: 'mock prompt',
        wait: async () => {
          if (callCount === 1) {
            return { exitCode: 1, logs: 'Error: 429 Too Many Requests' };
          }
          fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [x] Task 1');
          return { exitCode: 0, logs: 'Success after retry' };
        },
        stop: async () => {}
      };
    });
    
    mockSandbox.mockImplementation(() => {
      return {
        runTask: mockRunTask
      } as any;
    });

    workflowManager = new WorkflowManager();
    jest.useFakeTimers();

    const workflow = workflowManager.startWorkflow('test-429', testDir);

    let attempts = 0;
    while (callCount === 0 && attempts < 100) {
        await jest.advanceTimersByTimeAsync(100);
        attempts++;
    }
    
    expect(callCount).toBe(1);
    
    await jest.advanceTimersByTimeAsync(65000);
    
    attempts = 0;
    while (callCount === 1 && attempts < 100) {
        await jest.advanceTimersByTimeAsync(100);
        attempts++;
    }
    expect(callCount).toBe(2);

    attempts = 0;
    while (workflow.status !== 'Done' && attempts < 100) {
        await jest.advanceTimersByTimeAsync(5000);
        attempts++;
    }

    expect(workflow.status).toBe('Done');
    
    const logOutput = workflowManager.getLogs('test-429');
    expect(logOutput.content).toContain('Gemini API quota exceeded, waiting longer...');
    
    jest.useRealTimers();
  }, 20000);
});
