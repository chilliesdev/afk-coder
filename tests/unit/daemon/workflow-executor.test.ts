import { WorkflowExecutor } from '../../../src/daemon/workflow-executor';
import { WorkflowPhase } from '../../../src/daemon/workflow-phase';
import { Agent } from '../../../src/daemon/agent';
import { TaskBoard as ITaskBoard } from '../../../src/common/types';
import * as winston from 'winston';

describe('WorkflowExecutor Injection', () => {
  it('should run custom injected codingPhase and qaPhase', async () => {
    const mockAgent = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      kill: jest.fn().mockResolvedValue(undefined),
    } as unknown as Agent;

    const mockTaskBoard = {
      load: jest.fn().mockResolvedValue({
        progress: { completed: 0, total: 1, percentage: '0%' },
        pendingTasks: [{ description: 'Task 1', completed: false }],
        tasks: [{ description: 'Task 1', completed: false }]
      }),
      reconcile: jest.fn(),
      getTasks: jest.fn(),
    } as unknown as ITaskBoard;

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as winston.Logger;

    const mockCodingPhase: WorkflowPhase = {
      execute: jest.fn().mockResolvedValue('QA')
    };

    const mockQaPhase: WorkflowPhase = {
      execute: jest.fn().mockResolvedValue('Done')
    };

    const executor = new WorkflowExecutor(
      'test-wf',
      '/test/dir',
      mockAgent,
      mockTaskBoard,
      mockLogger,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      mockCodingPhase,
      mockQaPhase
    );

    await executor.start();

    let attempts = 0;
    while (executor.status !== 'Done' && executor.status !== 'Failed' && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }

    expect(executor.status).toBe('Done');
    expect(mockCodingPhase.execute).toHaveBeenCalled();
    expect(mockQaPhase.execute).toHaveBeenCalled();
  });

  it('should call autoCommitFailure when a phase returns Failed', async () => {
    const mockAgent = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      kill: jest.fn().mockResolvedValue(undefined),
    } as unknown as Agent;

    const mockTaskBoard = {
      load: jest.fn().mockResolvedValue({
        progress: { completed: 0, total: 1, percentage: '0%' },
        pendingTasks: [{ description: 'Task 1', completed: false }],
        tasks: [{ description: 'Task 1', completed: false }]
      }),
      reconcile: jest.fn(),
      getTasks: jest.fn(),
    } as unknown as ITaskBoard;

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as winston.Logger;

    const mockGitManager = {
      isAutoCommitEnabled: jest.fn().mockReturnValue(true),
      autoCommitCompletion: jest.fn().mockResolvedValue(undefined),
      autoCommitFailure: jest.fn().mockResolvedValue(undefined),
      autoCommitFailureWithException: jest.fn().mockResolvedValue(undefined),
    } as any;

    const mockCodingPhase: WorkflowPhase = {
      execute: jest.fn().mockResolvedValue('Failed_Compile')
    };

    const mockQaPhase: WorkflowPhase = {
      execute: jest.fn().mockResolvedValue('Done')
    };

    const executor = new WorkflowExecutor(
      'test-wf-fail',
      '/test/dir',
      mockAgent,
      mockTaskBoard,
      mockLogger,
      undefined,
      true, // isWorktree
      'source-repo',
      'test-branch',
      undefined,
      mockCodingPhase,
      mockQaPhase
    );
    (executor as any).gitManager = mockGitManager;

    await executor.start();

    let attempts = 0;
    while (executor.status !== 'Failed_Compile' && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }

    expect(executor.status).toBe('Failed_Compile');
    expect(mockGitManager.autoCommitFailure).toHaveBeenCalledWith('Failed_Compile');
  });

  it('should call autoCommitFailureWithException when loop throws an error', async () => {
    const mockAgent = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      kill: jest.fn().mockResolvedValue(undefined),
    } as unknown as Agent;

    const mockTaskBoard = {
      load: jest.fn().mockResolvedValue({
        progress: { completed: 0, total: 1, percentage: '0%' },
        pendingTasks: [{ description: 'Task 1', completed: false }],
        tasks: [{ description: 'Task 1', completed: false }]
      }),
      reconcile: jest.fn(),
      getTasks: jest.fn(),
    } as unknown as ITaskBoard;

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as winston.Logger;

    const mockGitManager = {
      isAutoCommitEnabled: jest.fn().mockReturnValue(true),
      autoCommitFailureWithException: jest.fn().mockResolvedValue(undefined),
    } as any;

    const mockCodingPhase: WorkflowPhase = {
      execute: jest.fn().mockRejectedValue(new Error('Phase crash'))
    };

    const executor = new WorkflowExecutor(
      'test-wf-crash',
      '/test/dir',
      mockAgent,
      mockTaskBoard,
      mockLogger,
      undefined,
      true, // isWorktree
      'source-repo',
      'test-branch',
      undefined,
      mockCodingPhase,
      undefined
    );
    (executor as any).gitManager = mockGitManager;

    await executor.start();

    let attempts = 0;
    while (executor.status !== 'Failed' && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }

    expect(executor.status).toBe('Failed');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Workflow loop failed with exception',
      expect.objectContaining({ error: 'Phase crash' })
    );
    expect(mockGitManager.autoCommitFailureWithException).toHaveBeenCalled();
  });

  it('should log warning and continue when agent stop throws error in loop finally', async () => {
    const mockAgent = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockRejectedValue(new Error('Stop failed')),
      kill: jest.fn().mockResolvedValue(undefined),
    } as unknown as Agent;

    const mockTaskBoard = {
      load: jest.fn().mockResolvedValue({
        progress: { completed: 0, total: 1, percentage: '0%' },
        pendingTasks: [{ description: 'Task 1', completed: false }],
        tasks: [{ description: 'Task 1', completed: false }]
      }),
      reconcile: jest.fn(),
      getTasks: jest.fn(),
    } as unknown as ITaskBoard;

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as winston.Logger;

    const mockCodingPhase: WorkflowPhase = {
      execute: jest.fn().mockResolvedValue('Done')
    };

    const executor = new WorkflowExecutor(
      'test-wf-stop-err',
      '/test/dir',
      mockAgent,
      mockTaskBoard,
      mockLogger,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      mockCodingPhase
    );

    await executor.start();

    let attempts = 0;
    while (executor.status !== 'Done' && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }

    expect(executor.status).toBe('Done');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to stop execution runtime container',
      expect.objectContaining({ error: 'Stop failed' })
    );
  });

  it('should handle kill command successfully', async () => {
    const mockAgent = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      kill: jest.fn().mockResolvedValue(undefined),
    } as unknown as Agent;

    const mockTaskBoard = {
      load: jest.fn(),
      reconcile: jest.fn(),
      getTasks: jest.fn(),
    } as unknown as ITaskBoard;

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as winston.Logger;

    const executor = new WorkflowExecutor(
      'test-wf-kill',
      '/test/dir',
      mockAgent,
      mockTaskBoard,
      mockLogger
    );

    await executor.kill();

    expect(executor.status).toBe('Killed');
    expect(mockAgent.kill).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('Workflow executor killed by user');
  });

  it('should format correctly toWorkflow output', () => {
    const mockAgent = {
      start: jest.fn(),
      stop: jest.fn(),
      kill: jest.fn(),
    } as unknown as Agent;

    const mockTaskBoard = {
      load: jest.fn(),
      reconcile: jest.fn(),
      getTasks: jest.fn().mockReturnValue([{ description: 'Task 1', completed: true }]),
    } as unknown as ITaskBoard;

    const mockLogger = {
      info: jest.fn(),
    } as unknown as winston.Logger;

    const executor = new WorkflowExecutor(
      'test-wf-to-wf',
      '/test/dir',
      mockAgent,
      mockTaskBoard,
      mockLogger
    );
    executor.status = 'Coding';
    executor.phase = 'Coding';
    executor.qaCycles = 2;

    const wf = executor.toWorkflow();
    expect(wf.name).toBe('test-wf-to-wf');
    expect(wf.dir).toBe('/test/dir');
    expect(wf.status).toBe('Coding');
    expect(wf.phase).toBe('Coding');
    expect(wf.qaCycles).toBe(2);
  });

  it('should handle agent start failure during runLoop startup', async () => {
    const mockAgent = {
      start: jest.fn().mockRejectedValue(new Error('Agent start failed')),
      stop: jest.fn().mockResolvedValue(undefined),
      kill: jest.fn().mockResolvedValue(undefined),
    } as unknown as Agent;

    const mockTaskBoard = {
      load: jest.fn(),
      reconcile: jest.fn(),
      getTasks: jest.fn(),
    } as unknown as ITaskBoard;

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as winston.Logger;

    const executor = new WorkflowExecutor(
      'test-wf-start-fail',
      '/test/dir',
      mockAgent,
      mockTaskBoard,
      mockLogger
    );

    await executor.start();

    let attempts = 0;
    while (executor.status !== 'Failed: Runtime Startup Error' && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }

    expect(executor.status).toBe('Failed: Runtime Startup Error');
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to start execution runtime container', expect.objectContaining({ error: 'Agent start failed' }));
  });

  it('should throw error and fail if workflow phase is unknown', async () => {
    const mockAgent = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      kill: jest.fn().mockResolvedValue(undefined),
    } as unknown as Agent;

    const mockTaskBoard = {
      load: jest.fn().mockResolvedValue({
        progress: { completed: 0, total: 1, percentage: '0%' },
        pendingTasks: [{ description: 'Task 1', completed: false }],
        tasks: [{ description: 'Task 1', completed: false }]
      }),
      reconcile: jest.fn(),
      getTasks: jest.fn(),
    } as unknown as ITaskBoard;

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as winston.Logger;

    const executor = new WorkflowExecutor(
      'test-wf-unknown-phase',
      '/test/dir',
      mockAgent,
      mockTaskBoard,
      mockLogger
    );
    executor.phase = 'InvalidPhase' as any;

    await executor.start();

    let attempts = 0;
    while (executor.status !== 'Failed' && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }

    expect(executor.status).toBe('Failed');
    expect(mockLogger.error).toHaveBeenCalledWith('Workflow loop failed with exception', expect.objectContaining({ error: 'Unknown workflow phase: InvalidPhase' }));
  });

  it('should handle runLoop promise rejection in start catch block', async () => {
    const mockAgent = {
      start: jest.fn(),
      stop: jest.fn(),
      kill: jest.fn(),
    } as unknown as Agent;

    const mockTaskBoard = {
      load: jest.fn(),
      reconcile: jest.fn(),
      getTasks: jest.fn(),
    } as unknown as ITaskBoard;

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
    } as unknown as winston.Logger;

    const executor = new WorkflowExecutor(
      'test-wf-loop-reject',
      '/test/dir',
      mockAgent,
      mockTaskBoard,
      mockLogger
    );

    jest.spyOn(executor as any, 'runLoop').mockRejectedValueOnce(new Error('Rejected runLoop'));

    await executor.start();

    let attempts = 0;
    while (executor.status !== 'Failed' && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }

    expect(executor.status).toBe('Failed');
    expect(mockLogger.error).toHaveBeenCalledWith('Workflow executor failed', expect.objectContaining({ error: 'Rejected runLoop' }));
  });
});
