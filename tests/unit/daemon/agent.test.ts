import { Agent } from '../../../src/daemon/agent';
import { MockRuntime } from '../../helpers/mock-runtime';
import { AiderAdapter } from '../../../src/daemon/agent-aider';
import { MILESTONE_STATUS, MilestoneEvent } from '../../../src/common/types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OutcomeAnalyzer } from '../../../src/daemon/agent-outcome';
import { AgentAdapter } from '../../../src/daemon/agent-adapter';
import { TaskBoard as ITaskBoard } from '../../../src/common/types';
import { ExecutionRuntime } from '../../../src/daemon/execution-runtime';

const actualFs = jest.requireActual('node:fs');
jest.mock('node:fs', () => {
  const actFs = jest.requireActual('node:fs');
  return {
    ...actFs,
    existsSync: jest.fn().mockImplementation((...args) => actFs.existsSync(...args)),
    writeFileSync: jest.fn().mockImplementation((...args) => actFs.writeFileSync(...args)),
    readFileSync: jest.fn().mockImplementation((...args) => actFs.readFileSync(...args)),
    unlinkSync: jest.fn().mockImplementation((...args) => actFs.unlinkSync(...args)),
  };
});

describe('Agent', () => {
  let agent: Agent;
  let mockRuntime: MockRuntime;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRuntime = new MockRuntime();
    agent = new Agent(mockRuntime);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.endsWith('PRD.md')) return true;
        if (p.endsWith('tasks.md')) return false;
        return false;
    });
    (fs.readFileSync as jest.Mock).mockReturnValue('- [ ] mock task');
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    (fs.unlinkSync as jest.Mock).mockImplementation(() => {});
  });

  it('should run autonomous loop with correct prompt', async () => {
    await agent.runAutonomousLoop('/some/dir');
    expect(mockRuntime.lastPrompt).toContain('gemini --yolo --output-format json --prompt');
    expect(mockRuntime.lastPrompt).toContain('tasks.md');
    expect(mockRuntime.lastPrompt).toContain('highest priority uncompleted task');
    expect(mockRuntime.lastDir).toBe('/some/dir');
  });

  it('should use AiderAdapter if provided', async () => {
    const aiderAgent = new Agent(mockRuntime, undefined, new AiderAdapter());
    await aiderAgent.runAutonomousLoop('/some/dir');
    expect(mockRuntime.lastPrompt).toContain('aider --yes --message');
    expect(mockRuntime.lastPrompt).toContain('tasks.md');
  });

  describe('generateTasks milestones', () => {
    it('should emit STARTING and COMPLETED milestones for runtime start', async () => {
      const milestones: MilestoneEvent[] = [];
      const onMilestone = (e: MilestoneEvent) => milestones.push(e);

      await agent.generateTasks('/some/dir', 'PRD.md', false, undefined, onMilestone);

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.STARTING,
        message: 'Starting execution runtime...'
      }));

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.COMPLETED,
        message: 'Execution runtime started'
      }));
    });

    it('should emit STARTING and COMPLETED milestones for task generation and validation', async () => {
      const milestones: MilestoneEvent[] = [];
      const onMilestone = (e: MilestoneEvent) => milestones.push(e);

      // Mock successful run
      mockRuntime.nextResult = { exitCode: 0, logs: 'Successfully generated tasks.md' };
      
      let tasksCreated = false;
      (fs.writeFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p.endsWith('tasks.md')) tasksCreated = true;
      });

      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.endsWith('PRD.md')) return true;
        if (p.endsWith('tasks.md')) return tasksCreated;
        return false;
      });

      await agent.generateTasks('/some/dir', 'PRD.md', false, undefined, onMilestone);

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.STARTING,
        message: 'Analyzing PRD and generating tasks...'
      }));

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.COMPLETED,
        message: 'Analyzing PRD and generating tasks...'
      }));

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.STARTING,
        message: 'Validating generated tasks...'
      }));

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.COMPLETED,
        message: 'Tasks validated'
      }));

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.STARTING,
        message: 'Finalizing task generation...'
      }));

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.COMPLETED,
        message: 'Successfully generated tasks.md'
      }));
    });

    it('should emit FAILED milestone if runtime start fails', async () => {
      jest.spyOn(mockRuntime, 'start').mockRejectedValue(new Error('Docker failed'));
      const milestones: MilestoneEvent[] = [];
      const onMilestone = (e: MilestoneEvent) => milestones.push(e);

      await agent.generateTasks('/some/dir', 'PRD.md', false, undefined, onMilestone);

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.STARTING,
        message: 'Starting execution runtime...'
      }));

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.FAILED,
        message: 'Failed to start runtime: Docker failed'
      }));
    });
  });
});

describe('Agent Core Loop Logic', () => {
  let agent: Agent;
  let mockRuntime: jest.Mocked<ExecutionRuntime>;
  let mockAnalyzer: jest.Mocked<OutcomeAnalyzer>;
  let mockAdapter: jest.Mocked<AgentAdapter>;
  let mockTaskBoard: jest.Mocked<ITaskBoard>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRuntime = {
      run: jest.fn(),
    } as any;

    mockAnalyzer = {
      analyze: jest.fn(),
      parseAgentOutput: jest.fn(),
    } as any;

    mockAdapter = {
      getAutonomousLoopCommand: jest.fn().mockReturnValue('mock-command'),
      getQALoopCommand: jest.fn().mockReturnValue('mock-qa-command'),
      getTaskGenerationCommand: jest.fn(),
    } as any;

    mockTaskBoard = {
      reconcile: jest.fn(),
    } as any;

    agent = new Agent(mockRuntime, mockAnalyzer, mockAdapter);
    
    // Silence delay and provide default analyzer behavior
    jest.spyOn(agent as any, 'delay').mockResolvedValue(undefined);
    mockAnalyzer.analyze.mockReturnValue({
      action: 'fail',
      delayMs: 0,
      tokens: { input: 0, output: 0, total: 0 },
      error: { type: 'Runtime', message: 'Default Error' }
    });
  });

  describe('executeCodingLoop', () => {
    it('should complete successfully on first attempt', async () => {
      mockRuntime.run.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ exitCode: 0, logs: 'agent-logs' }),
        stop: jest.fn(),
        prompt: 'mock-command'
      });

      mockTaskBoard.reconcile.mockResolvedValue({
        newlyCompleted: [{ description: 'Task 1', completed: true }],
        state: {
          progress: { completed: 1, total: 1, percentage: '100%' },
          pendingTasks: [],
          tasks: [{ description: 'Task 1', completed: true }]
        }
      });

      mockAnalyzer.analyze.mockReturnValue({
        action: 'next',
        delayMs: 100,
        tokens: { input: 10, output: 20, total: 30 }
      });

      const result = await agent.executeCodingLoop('/dir', mockTaskBoard);

      expect(result.success).toBe(true);
      expect(result.tokenUsage).toEqual({ input: 10, output: 20, total: 30 });
      expect(result.newlyCompletedTasks).toHaveLength(1);
      expect(mockRuntime.run).toHaveBeenCalledWith('mock-command', '/dir', undefined);
      expect(mockAnalyzer.analyze).toHaveBeenCalledWith('agent-logs', 0, 0, 1);
    });

    it('should retry when analyzer returns retry action', async () => {
      // First run: fails
      mockRuntime.run.mockResolvedValueOnce({
        wait: jest.fn().mockResolvedValue({ exitCode: 1, logs: 'failed logs' }),
        stop: jest.fn(),
        prompt: 'mock-command'
      });
      // Second run: succeeds
      mockRuntime.run.mockResolvedValueOnce({
        wait: jest.fn().mockResolvedValue({ exitCode: 0, logs: 'success logs' }),
        stop: jest.fn(),
        prompt: 'mock-command'
      });

      mockTaskBoard.reconcile.mockResolvedValue({ 
        newlyCompleted: [{ description: 'Task 1', completed: true }], 
        state: {} as any 
      });

      mockAnalyzer.analyze.mockReturnValueOnce({
        action: 'retry',
        delayMs: 1000,
        tokens: { input: 5, output: 5, total: 10 }
      });
      mockAnalyzer.analyze.mockReturnValueOnce({
        action: 'next',
        delayMs: 0,
        tokens: { input: 10, output: 10, total: 20 }
      });

      const result = await agent.executeCodingLoop('/dir', mockTaskBoard);

      expect(result.success).toBe(true);
      expect(result.tokenUsage.total).toBe(30);
      expect(mockRuntime.run).toHaveBeenCalledTimes(2);
      expect(mockAnalyzer.analyze).toHaveBeenCalledTimes(2);
      expect(mockAnalyzer.analyze).toHaveBeenNthCalledWith(1, 'failed logs', 1, 0, 0);
      expect(mockAnalyzer.analyze).toHaveBeenNthCalledWith(2, 'success logs', 0, 1, 1);
      expect((agent as any).delay).toHaveBeenCalledWith(1000);
    });

    it('should fail when max retries reached or analyzer says fail', async () => {
      mockRuntime.run.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ exitCode: 1, logs: 'persistent fail' }),
        stop: jest.fn(),
        prompt: 'mock-command'
      });

      mockTaskBoard.reconcile.mockResolvedValue({ newlyCompleted: [], state: {} as any });

      mockAnalyzer.analyze.mockReturnValue({
        action: 'fail',
        delayMs: 0,
        tokens: { input: 5, output: 5, total: 10 },
        error: { type: 'Runtime', message: 'Max retries reached' }
      });

      const result = await agent.executeCodingLoop('/dir', mockTaskBoard);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Max retries reached');
      expect(mockRuntime.run).toHaveBeenCalledTimes(1);
    });

    it('should handle runtime exceptions and retry if analyzer allows', async () => {
      mockRuntime.run.mockRejectedValueOnce(new Error('Runtime Crash'));
      mockRuntime.run.mockResolvedValueOnce({
        wait: jest.fn().mockResolvedValue({ exitCode: 0, logs: 'recovered' }),
        stop: jest.fn(),
        prompt: 'mock-command'
      });

      mockTaskBoard.reconcile.mockResolvedValue({ newlyCompleted: [], state: {} as any });

      mockAnalyzer.analyze.mockReturnValueOnce({
        action: 'retry',
        delayMs: 500,
        tokens: { input: 0, output: 0, total: 0 }
      });
      mockAnalyzer.analyze.mockReturnValueOnce({
        action: 'next',
        delayMs: 0,
        tokens: { input: 10, output: 10, total: 20 }
      });

      const result = await agent.executeCodingLoop('/dir', mockTaskBoard);

      expect(result.success).toBe(true);
      expect(mockAnalyzer.analyze).toHaveBeenCalledWith('Runtime Crash', -1, 0, 0);
      expect((agent as any).delay).toHaveBeenCalledWith(500);
    });
  });

  describe('executeQALoop', () => {
    it('should complete QA loop successfully', async () => {
      mockRuntime.run.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ exitCode: 0, logs: 'qa success' }),
        stop: jest.fn(),
        prompt: 'mock-qa-command'
      });

      mockAnalyzer.parseAgentOutput.mockReturnValue({
        success: true,
        tokens: { input: 20, output: 30, total: 50 }
      });

      const result = await agent.executeQALoop('/dir', mockTaskBoard);

      expect(result.success).toBe(true);
      expect(result.tokenUsage.total).toBe(50);
      expect(mockAnalyzer.parseAgentOutput).toHaveBeenCalledWith('qa success', 0);
    });

    it('should retry QA loop on failure', async () => {
      mockRuntime.run.mockResolvedValueOnce({
        wait: jest.fn().mockResolvedValue({ exitCode: 1, logs: 'qa fail' }),
        stop: jest.fn(),
        prompt: 'mock-qa-command'
      });
      mockRuntime.run.mockResolvedValueOnce({
        wait: jest.fn().mockResolvedValue({ exitCode: 0, logs: 'qa success' }),
        stop: jest.fn(),
        prompt: 'mock-qa-command'
      });

      mockAnalyzer.analyze.mockReturnValueOnce({
        action: 'retry',
        delayMs: 200,
        tokens: { input: 5, output: 5, total: 10 }
      });
      mockAnalyzer.parseAgentOutput.mockReturnValue({
        success: true,
        tokens: { input: 10, output: 10, total: 20 }
      });

      const result = await agent.executeQALoop('/dir', mockTaskBoard);

      expect(result.success).toBe(true);
      expect(result.tokenUsage.total).toBe(30);
      expect(mockRuntime.run).toHaveBeenCalledTimes(2);
      expect((agent as any).delay).toHaveBeenCalledWith(200);
    });
  });

  describe('kill', () => {
    it('should stop running process when killed', async () => {
      const stopMock = jest.fn().mockResolvedValue(undefined);
      let resolveWait: any;
      const waitPromise = new Promise((resolve) => {
        resolveWait = resolve;
      });

      mockRuntime.run.mockResolvedValue({
        wait: () => waitPromise,
        stop: stopMock,
        prompt: 'mock-command'
      } as any);

      const loopPromise = agent.executeCodingLoop('/dir', mockTaskBoard);
      
      // Wait a bit to ensure it started
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await agent.kill();
      
      // Resolve wait so the loop can continue and check isKilled
      resolveWait({ exitCode: 0, logs: '' });
      
      const result = await loopPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent killed');
      expect(stopMock).toHaveBeenCalled();
    });
  });
});

describe('Agent Task Generation', () => {
  const TEST_DIR = path.resolve('./test-task-generator');
  let mockRuntime: MockRuntime;
  let agent: Agent;

  beforeEach(() => {
    jest.clearAllMocks();
    if (actualFs.existsSync(TEST_DIR)) {
      actualFs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    actualFs.mkdirSync(TEST_DIR);
    mockRuntime = new MockRuntime();
    agent = new Agent(mockRuntime);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => actualFs.existsSync(p));
    (fs.readFileSync as jest.Mock).mockImplementation((p: string, encoding: any) => actualFs.readFileSync(p, encoding));
    (fs.writeFileSync as jest.Mock).mockImplementation((p: string, data: any, options: any) => actualFs.writeFileSync(p, data, options));
    (fs.unlinkSync as jest.Mock).mockImplementation((p: string) => actualFs.unlinkSync(p));
  });

  afterEach(() => {
    if (actualFs.existsSync(TEST_DIR)) {
      actualFs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should generate tasks.md successfully when PRD is present', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD Content');
    mockRuntime.nextResult = {
      exitCode: 0,
      logs: 'Some logs...'
    };

    // Simulate agent writing to tasks.md
    const originalRun = mockRuntime.run.bind(mockRuntime);
    mockRuntime.run = async (prompt, dir, configDir) => {
      const handle = await originalRun(prompt, dir, configDir);
      const originalWait = handle.wait.bind(handle);
      handle.wait = async () => {
        fs.writeFileSync(path.join(TEST_DIR, 'tasks.md'), '- [ ] Generated Task 1');
        return originalWait();
      };
      return handle;
    };

    const res = await agent.generateTasks(TEST_DIR, 'PRD.md');
    expect(res.success).toBe(true);
    expect(res.logs).toContain('Successfully generated tasks.md');
    expect(fs.readFileSync(path.join(TEST_DIR, 'tasks.md'), 'utf8')).toBe('- [ ] Generated Task 1');
    expect(mockRuntime.startCalled).toBe(true);
    expect(mockRuntime.stopCalled).toBe(true);
  });

  it('should fall back to parsing stdout if file was left empty', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD Content');
    mockRuntime.nextResult = {
      exitCode: 0,
      logs: 'Logs\n- [ ] Task from stdout 1\n- [ ] Task from stdout 2'
    };

    const res = await agent.generateTasks(TEST_DIR, 'PRD.md');
    expect(res.success).toBe(true);
    expect(res.logs).toContain('Successfully generated tasks.md');
    expect(fs.readFileSync(path.join(TEST_DIR, 'tasks.md'), 'utf8')).toBe('- [ ] Task from stdout 1\n- [ ] Task from stdout 2');
    expect(mockRuntime.startCalled).toBe(true);
    expect(mockRuntime.stopCalled).toBe(true);
  });

  it('should fail and clean up tasks.md if exit code is non-zero and file is empty', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD Content');
    mockRuntime.nextResult = {
      exitCode: 1,
      logs: 'Fatal Sandbox Error'
    };

    const res = await agent.generateTasks(TEST_DIR, 'PRD.md');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Exit code 1');
    expect(fs.existsSync(path.join(TEST_DIR, 'tasks.md'))).toBe(false);
    expect(mockRuntime.startCalled).toBe(true);
    expect(mockRuntime.stopCalled).toBe(true);
  });

  it('should fail if PRD.md does not exist', async () => {
    const res = await agent.generateTasks(TEST_DIR, 'PRD.md');
    expect(res.success).toBe(false);
    expect(res.error).toContain('PRD.md not found');
    expect(mockRuntime.startCalled).toBe(false);
    expect(mockRuntime.stopCalled).toBe(false);
  });

  it('should fail if tasks.md already exists and force is false', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD Content');
    fs.writeFileSync(path.join(TEST_DIR, 'tasks.md'), '- [x] Existing Task');

    const res = await agent.generateTasks(TEST_DIR, 'PRD.md', false);
    expect(res.success).toBe(false);
    expect(res.error).toContain('already exists');
    expect(fs.readFileSync(path.join(TEST_DIR, 'tasks.md'), 'utf8')).toBe('- [x] Existing Task');
    expect(mockRuntime.startCalled).toBe(false);
    expect(mockRuntime.stopCalled).toBe(false);
  });
});
