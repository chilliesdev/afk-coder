import { WorkflowManager } from '../src/daemon/workflow-manager';
import * as fs from 'fs';
import * as path from 'path';
import { MockRuntime } from './mocks/mock-runtime';
import { Agent } from '../src/daemon/agent';

describe('WorkflowManager Integration', () => {
  let workflowManager: WorkflowManager;
  let mockRuntime: MockRuntime;
  const testDir = path.resolve('./test-workflow');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir);
    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD\nTest PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
    
    mockRuntime = new MockRuntime();
    workflowManager = new WorkflowManager(new Agent(mockRuntime));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should start a workflow and run tasks', async () => {
    mockRuntime.nextResult = { 
      exitCode: 0, 
      logs: 'Task completed! Tokens: 10 input, 20 output' 
    };

    // We don't need to mock wait manually, MockRuntime handles it.
    // But we need to make sure tasks.md is updated so the loop finishes.
    
    const workflowInit = await workflowManager.startWorkflow('test-workflow', testDir);
    expect(workflowInit.status).toMatch(/^Running/);
    expect(workflowInit.name).toBe('test-workflow');

    // Simulate agent marking task as done
    // In a real integration test, the agent would do this. 
    // Here we can do it after a short delay or by mocking the runtime's wait to do it.
    
    const originalRun = mockRuntime.run.bind(mockRuntime);
    mockRuntime.run = async (prompt, dir, configDir) => {
      const handle = await originalRun(prompt, dir, configDir);
      const originalWait = handle.wait.bind(handle);
      handle.wait = async () => {
        fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [x] Task 1');
        return await originalWait();
      };
      return handle;
    };

    let attempts = 0;
    let workflow = workflowManager.getWorkflow('test-workflow')!;
    while (workflow.status !== 'Done' && workflow.status !== 'Failed' && attempts < 60) {
      await new Promise(resolve => setTimeout(resolve, 500));
      workflow = workflowManager.getWorkflow('test-workflow')!;
      attempts++;
    }

    expect(workflow.status).toBe('Done');
    expect(workflow.progress).toBe('1/1');
    
    const logs = workflowManager.getLogs('test-workflow');
    expect(logs.content).toContain('Tasks completed successfully');
    expect(logs.content).toContain('"input":10,"output":20');
  }, 40000);

  it('should allow restarting a workflow that is Done or Failed', async () => {
    mockRuntime.nextResult = { exitCode: 0, logs: 'Done' };
    
    const originalRun = mockRuntime.run.bind(mockRuntime);
    mockRuntime.run = async (prompt, dir, configDir) => {
      const handle = await originalRun(prompt, dir, configDir);
      const originalWait = handle.wait.bind(handle);
      handle.wait = async () => {
        fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [x] Task 1');
        return await originalWait();
      };
      return handle;
    };

    await workflowManager.startWorkflow('restart-test', testDir);
    
    // Wait for it to be Done
    let attempts = 0;
    while (workflowManager.listWorkflows().find(w => w.name === 'restart-test')?.status !== 'Done' && attempts < 100) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    expect(workflowManager.listWorkflows().find(w => w.name === 'restart-test')?.status).toBe('Done');

    // Attempt to start it again
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1'); // Reset tasks
    await workflowManager.startWorkflow('restart-test', testDir);
    
    const workflow = workflowManager.listWorkflows().find(w => w.name === 'restart-test');
    expect(workflow?.status).toMatch(/^Running/);
  }, 20000);
});
