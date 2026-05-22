import { Agent } from '../src/daemon/agent';
import { OutcomeAnalyzer } from '../src/daemon/agent-outcome';
import { AgentAdapter } from '../src/daemon/agent-adapter';
import { TaskBoard as ITaskBoard } from '../src/common/types';
import { ExecutionRuntime } from '../src/daemon/execution-runtime';

describe('Agent Core Loop Logic', () => {
  let agent: Agent;
  let mockRuntime: jest.Mocked<ExecutionRuntime>;
  let mockAnalyzer: jest.Mocked<OutcomeAnalyzer>;
  let mockAdapter: jest.Mocked<AgentAdapter>;
  let mockTaskBoard: jest.Mocked<ITaskBoard>;

  beforeEach(() => {
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
