import { WorkflowManager } from '../src/daemon/workflow-manager';
import { Agent } from '../src/daemon/agent';
import { MockRuntime } from './mocks/mock-runtime';
import { TaskBoard } from '../src/daemon/task-board';
import { FileSystemTaskStorage } from '../src/daemon/task-storage';
import { TaskValidator } from '../src/common/validation';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.resolve('./test-workflow-manager-init');

describe('WorkflowManager.init', () => {
  let workflowManager: WorkflowManager;
  let mockRuntime: MockRuntime;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR);
    
    mockRuntime = new MockRuntime();
    const agentFactory = () => new Agent(mockRuntime);
    const taskBoardFactory = (p: string) => new TaskBoard(new FileSystemTaskStorage(p), new TaskValidator());
    
    workflowManager = new WorkflowManager(agentFactory, taskBoardFactory);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should call agent.generateTasks and report milestones', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD');
    mockRuntime.nextResult = {
      exitCode: 0,
      logs: '- [ ] Task 1'
    };

    const milestones: any[] = [];
    const onMilestone = (m: any) => milestones.push(m);

    const result = await workflowManager.init({
      dir: TEST_DIR,
      prd: 'PRD.md'
    }, onMilestone);

    expect(result.success).toBe(true);
    expect(milestones.length).toBeGreaterThan(0);
    expect(milestones[0].status).toBe('starting');
    expect(milestones.some(m => m.status === 'completed')).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'tasks.md'))).toBe(true);
  });
});
