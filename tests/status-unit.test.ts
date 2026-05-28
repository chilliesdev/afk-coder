import { WorkflowManager } from '../src/daemon/workflow-manager';
import * as fs from 'fs';
import * as path from 'path';
import { MockRuntime } from './mocks/mock-runtime';
import { Agent } from '../src/daemon/agent';

describe('WorkflowManager Status Updates', () => {
  let workflowManager: WorkflowManager;
  let mockRuntime: MockRuntime;
  const testDir = path.resolve('./test-status-unit');
  const testStateDir = path.resolve('./test-status-xdg-state');
  let originalXdgStateHome: string | undefined;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testStateDir)) {
      fs.rmSync(testStateDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir);
    fs.mkdirSync(testStateDir);

    originalXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = testStateDir;

    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# Dummy PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3\n- [ ] Task 4\n- [ ] Task 5\n- [ ] Task 6');

    mockRuntime = new MockRuntime();
    mockRuntime.runDelay = 100;
    workflowManager = new WorkflowManager(() => new Agent(mockRuntime));
  });

  afterEach(() => {
    process.env.XDG_STATE_HOME = originalXdgStateHome;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testStateDir)) {
      fs.rmSync(testStateDir, { recursive: true, force: true });
    }
  });

  it('should initialize and update status fields correctly', async () => {
    let taskCount = 0;
    
    const originalRun = mockRuntime.run.bind(mockRuntime);
    mockRuntime.run = async (prompt, dir, configDir) => {
      taskCount++;
      const currentTaskCount = taskCount;
      const handle = await originalRun(prompt, dir, configDir);
      const originalWait = handle.wait.bind(handle);
      handle.wait = async () => {
        // Mark task as done in tasks.md
        const content = fs.readFileSync(path.join(testDir, 'tasks.md'), 'utf-8');
        const lines = content.split('\n');
        const taskIndex = lines.findIndex(l => l.includes(`Task ${currentTaskCount}`) && l.includes('[ ]'));
        if (taskIndex !== -1) {
          lines[taskIndex] = lines[taskIndex].replace('[ ]', '[x]');
          fs.writeFileSync(path.join(testDir, 'tasks.md'), lines.join('\n'));
        }
        return { 
          exitCode: 0, 
          logs: `Task ${currentTaskCount} done. Token usage: 10 prompt, 5 completion` 
        };
      };
      return handle;
    };

    await workflowManager.startWorkflow('test-wf', testDir);
    
    let workflow = workflowManager.getWorkflow('test-wf')!;
    // Initial check
    expect(workflow.tokenUsage).toEqual({ input: 0, output: 0, total: 0 });
    expect(workflow.recentTasks).toEqual([]);
    
    // Wait for first task to start
    workflow = workflowManager.getWorkflow('test-wf')!;
    while (workflow && !workflow.currentTask && workflow.status !== 'Done') {
      await new Promise(resolve => setTimeout(resolve, 10));
      workflow = workflowManager.getWorkflow('test-wf')!;
    }
    expect(workflow.currentTask).toBe('Autonomous Task Selection');

    // Wait for tasks to complete
    let attempts = 0;
    while (workflow && workflow.status !== 'Done' && attempts < 200) {
      await new Promise(resolve => setTimeout(resolve, 500));
      workflow = workflowManager.getWorkflow('test-wf')!;
      attempts++;
    }

    workflow = workflowManager.getWorkflow('test-wf')!;
    if (workflow.status !== 'Done') {
      const logFile = path.join(testStateDir, 'afk-coder', 'logs', 'test-wf.json.log');
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
