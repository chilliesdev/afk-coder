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
});
