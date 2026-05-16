import { WorkflowManager } from '../src/daemon/workflow-manager';
import * as fs from 'fs';
import * as path from 'path';
import { Sandbox } from '../src/sandbox';

jest.mock('../src/sandbox');

describe('WorkflowManager Integration', () => {
  let workflowManager: WorkflowManager;
  const testDir = path.resolve('./test-workflow');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir);
    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD\nTest PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
    
    workflowManager = new WorkflowManager();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should start a workflow and run tasks', async () => {
    const mockSandbox = Sandbox as jest.MockedClass<typeof Sandbox>;
    const mockRunTask = jest.fn().mockResolvedValue({
      pid: 123,
      prompt: 'mock prompt',
      wait: async () => {
        // Simulate task marking itself as done
        fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [x] Task 1');
        return { exitCode: 0, logs: 'Task completed! Tokens: 10 input, 20 output' };
      },
      stop: async () => {}
    });
    
    mockSandbox.mockImplementation(() => {
      return {
        runTask: mockRunTask
      } as any;
    });

    workflowManager = new WorkflowManager();
    const workflow = workflowManager.startWorkflow('test-workflow', testDir);
    expect(workflow.status).toMatch(/^Running/);
    expect(workflow.name).toBe('test-workflow');

    // Wait for the loop to finish (it should finish because we mark task as done)
    
    let attempts = 0;
    while (workflow.status !== 'Done' && workflow.status !== 'Failed' && attempts < 60) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    expect(workflow.status).toBe('Done');
    expect(workflow.progress).toBe('1/1');
    
    const logs = workflowManager.getLogs('test-workflow');
    expect(logs.content).toContain('Task completed successfully');
    expect(logs.content).toContain('"input":10,"output":20');
    expect(logs.content).toContain('mock prompt');
  }, 40000);

  it('should allow restarting a workflow that is Done or Failed', async () => {
    const mockSandbox = Sandbox as jest.MockedClass<typeof Sandbox>;
    mockSandbox.mockImplementation(() => {
      return {
        runTask: jest.fn().mockResolvedValue({
          pid: 123,
          prompt: 'mock prompt',
          wait: async () => {
            fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [x] Task 1');
            return { exitCode: 0, logs: 'Done' };
          },
          stop: async () => {}
        })
      } as any;
    });

    workflowManager.startWorkflow('restart-test', testDir);
    
    // Wait for it to be Done
    let attempts = 0;
    while (workflowManager.listWorkflows().find(w => w.name === 'restart-test')?.status !== 'Done' && attempts < 100) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    expect(workflowManager.listWorkflows().find(w => w.name === 'restart-test')?.status).toBe('Done');

    // Attempt to start it again
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1'); // Reset tasks
    expect(() => workflowManager.startWorkflow('restart-test', testDir)).not.toThrow();
    
    const workflow = workflowManager.listWorkflows().find(w => w.name === 'restart-test');
    expect(workflow?.status).toMatch(/^Running/);
  }, 20000);
});
