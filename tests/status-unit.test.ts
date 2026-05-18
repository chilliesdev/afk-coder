import { WorkflowManager } from '../src/daemon/workflow-manager';
import * as fs from 'fs';
import * as path from 'path';
import { MockRuntime } from './mocks/mock-runtime';
import { AgentStrategy } from '../src/daemon/agent-strategy';

describe('WorkflowManager Status Updates', () => {
  let workflowManager: WorkflowManager;
  let mockRuntime: MockRuntime;
  let strategy: AgentStrategy;
  const testDir = path.resolve('./test-status-unit');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir);
    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# Dummy PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3\n- [ ] Task 4\n- [ ] Task 5\n- [ ] Task 6');

    mockRuntime = new MockRuntime();
    mockRuntime.runDelay = 100;
    strategy = new AgentStrategy();
    workflowManager = new WorkflowManager(mockRuntime, strategy);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
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

    const workflow = await workflowManager.startWorkflow('test-wf', testDir);
    
    // Initial check
    expect(workflow.tokenUsage).toEqual({ input: 0, output: 0, total: 0 });
    expect(workflow.recentTasks).toEqual([]);
    
    // Wait for first task to start
    while (!workflow.currentTask && workflow.status !== 'Done') {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(workflow.currentTask).toBe('Autonomous Task Selection');

    // Wait for tasks to complete
    let attempts = 0;
    while (workflow.status !== 'Done' && attempts < 200) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (workflow.status !== 'Done') {
      const logFile = path.join(testDir, 'workflow.json.log');
      if (fs.existsSync(logFile)) {
        console.log('Workflow Logs on Failure:');
        console.log(fs.readFileSync(logFile, 'utf-8'));
      }
    }

    expect(workflow.status).toBe('Done');
    expect(workflow.tokenUsage).toEqual({ 
      input: 60, // 6 tasks * 10
      output: 30, // 6 tasks * 5
      total: 90 
    });
    
    // Recent tasks should be capped at 5 and in reverse order (newest first)
    expect(workflow.recentTasks).toHaveLength(5);
    expect(workflow.recentTasks[0]).toBe('Task 6');
    expect(workflow.recentTasks[4]).toBe('Task 2');
    expect(workflow.currentTask).toBeUndefined();
  }, 120000);
});
