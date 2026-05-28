import { IpcHandler } from '../../../src/daemon/ipc-handler';
import { WorkflowManager } from '../../../src/daemon/workflow-manager';
import * as net from 'node:net';
import * as winston from 'winston';
import { MILESTONE_STATUS } from '../../../src/common/types';

describe('IpcHandler', () => {
  let mockWorkflowManager: any;
  let mockLogger: any;
  let mockSocket: any;
  let handler: IpcHandler;
  let socketCallbacks: Record<string, Function>;
  let loggerCallbacks: Record<string, Function>;
  let managerCallbacks: Record<string, Function>;

  beforeEach(() => {
    socketCallbacks = {};
    loggerCallbacks = {};
    managerCallbacks = {};

    mockWorkflowManager = {
      listWorkflows: jest.fn().mockReturnValue([]),
      getWorkflow: jest.fn(),
      init: jest.fn(),
      startWorkflow: jest.fn(),
      killWorkflow: jest.fn(),
      removeWorkflow: jest.fn(),
      getExecutor: jest.fn(),
      getLogs: jest.fn(),
      on: jest.fn().mockImplementation((event, cb) => {
        managerCallbacks[event] = cb;
      }),
      off: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      on: jest.fn().mockImplementation((event, cb) => {
        loggerCallbacks[event] = cb;
      }),
      off: jest.fn(),
    };

    mockSocket = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn().mockImplementation((event, cb) => {
        socketCallbacks[event] = cb;
      }),
    };

    handler = new IpcHandler(mockWorkflowManager, mockLogger);
  });

  it('should handle invalid JSON input gracefully', async () => {
    await handler.handleConnection(mockSocket, 'invalid-json');

    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('"success":false')
    );
    expect(mockSocket.end).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should handle unknown command correctly', async () => {
    const unknownRequest = Buffer.from(JSON.stringify({ command: 'unknown-cmd' }));
    await handler.handleConnection(mockSocket, unknownRequest);

    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('"success":false')
    );
    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('Unknown command')
    );
    expect(mockSocket.end).toHaveBeenCalled();
  });

  it('should handle list command correctly', async () => {
    const listRequest = Buffer.from(JSON.stringify({ command: 'list' }));
    mockWorkflowManager.listWorkflows.mockReturnValue([{ name: 'test-wf' }]);
    await handler.handleConnection(mockSocket, listRequest);

    expect(mockWorkflowManager.listWorkflows).toHaveBeenCalled();
    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('"success":true')
    );
    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('test-wf')
    );
    expect(mockSocket.end).toHaveBeenCalled();
  });

  it('should handle init command correctly', async () => {
    const initRequest = Buffer.from(JSON.stringify({
      command: 'init',
      args: { dir: '.', prd: 'PRD.md' }
    }));
    mockWorkflowManager.init.mockImplementation(async (args: any, onMilestone: any) => {
      onMilestone({ status: MILESTONE_STATUS.STARTING, message: 'Initializing' });
      return { success: true, logs: 'init logs' };
    });

    await handler.handleConnection(mockSocket, initRequest);

    expect(mockWorkflowManager.init).toHaveBeenCalledWith(
      { dir: '.', prd: 'PRD.md' },
      expect.any(Function)
    );
    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('Initializing')
    );
    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('"data":"init logs"')
    );
    expect(mockSocket.end).toHaveBeenCalled();
  });

  it('should handle start command correctly', async () => {
    const startRequest = Buffer.from(JSON.stringify({
      command: 'start',
      args: { name: 'wf-name', dir: '/path', configDir: '/config', isWorktree: true, sourceRepo: '/src', branch: 'br', agent: 'gemini' }
    }));
    mockWorkflowManager.startWorkflow.mockResolvedValue({ name: 'wf-name' });

    await handler.handleConnection(mockSocket, startRequest);

    expect(mockWorkflowManager.startWorkflow).toHaveBeenCalledWith(
      'wf-name',
      '/path',
      { configDir: '/config', isWorktree: true, sourceRepo: '/src', branch: 'br', agent: 'gemini' }
    );
    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('"success":true')
    );
  });

  it('should handle status command when workflow is found', async () => {
    const statusRequest = Buffer.from(JSON.stringify({ command: 'status', args: { name: 'wf-name' } }));
    mockWorkflowManager.getWorkflow.mockReturnValue({ name: 'wf-name', status: 'Running' });

    await handler.handleConnection(mockSocket, statusRequest);

    expect(mockWorkflowManager.getWorkflow).toHaveBeenCalledWith('wf-name');
    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('"status":"Running"'));
  });

  it('should handle status command when workflow is not found', async () => {
    const statusRequest = Buffer.from(JSON.stringify({ command: 'status', args: { name: 'non-existent' } }));
    mockWorkflowManager.getWorkflow.mockReturnValue(null);

    await handler.handleConnection(mockSocket, statusRequest);

    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('"success":false'));
    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('Workflow non-existent not found'));
  });

  it('should handle kill command correctly', async () => {
    const killRequest = Buffer.from(JSON.stringify({ command: 'kill', args: { name: 'wf-name' } }));

    await handler.handleConnection(mockSocket, killRequest);

    expect(mockWorkflowManager.killWorkflow).toHaveBeenCalledWith('wf-name');
    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('Killed wf-name'));
  });

  it('should handle remove command correctly', async () => {
    const removeRequest = Buffer.from(JSON.stringify({ command: 'remove', args: { name: 'wf-name', deleteDir: true } }));
    mockWorkflowManager.getWorkflow.mockReturnValue({ name: 'wf-name', dir: '/dir', isWorktree: true });

    await handler.handleConnection(mockSocket, removeRequest);

    expect(mockWorkflowManager.removeWorkflow).toHaveBeenCalledWith('wf-name', undefined, true);
    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('Removed wf-name'));
  });

  it('should handle non-follow logs command correctly', async () => {
    const logsRequest = Buffer.from(JSON.stringify({
      command: 'logs',
      args: { name: 'wf-name', tail: '10', offset: '5', daemon: false }
    }));
    mockWorkflowManager.getLogs.mockReturnValue({ content: 'logs content' });

    await handler.handleConnection(mockSocket, logsRequest);

    expect(mockWorkflowManager.getLogs).toHaveBeenCalledWith('wf-name', { tail: 10, offset: 5, daemon: false });
    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('logs content'));
  });

  it('should throw error on follow logs when workflow does not exist', async () => {
    const logsRequest = Buffer.from(JSON.stringify({
      command: 'logs',
      args: { name: 'non-existent', follow: true }
    }));
    mockWorkflowManager.getExecutor.mockReturnValue(null);

    await handler.handleConnection(mockSocket, logsRequest);

    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('Workflow non-existent not found'));
  });

  it('should follow daemon logs correctly and clean up callbacks on socket close/error', async () => {
    const logsRequest = Buffer.from(JSON.stringify({
      command: 'logs',
      args: { daemon: true, follow: true, tail: '5' }
    }));
    mockWorkflowManager.getLogs.mockReturnValue({ content: 'old daemon log 1\nold daemon log 2\n' });

    await handler.handleConnection(mockSocket, logsRequest);

    expect(mockSocket.write).toHaveBeenCalledWith(JSON.stringify({ success: true }) + '\n');
    expect(mockSocket.write).toHaveBeenCalledWith(JSON.stringify({ type: 'log', content: 'old daemon log 1' }) + '\n');
    expect(mockSocket.write).toHaveBeenCalledWith(JSON.stringify({ type: 'log', content: 'old daemon log 2' }) + '\n');

    expect(mockLogger.on).toHaveBeenCalledWith('data', expect.any(Function));
    
    // Simulate data incoming to logger
    loggerCallbacks['data']({ message: 'new logger line' });
    expect(mockSocket.write).toHaveBeenLastCalledWith(JSON.stringify({ type: 'log', content: '{"message":"new logger line"}' }) + '\n');

    // Trigger close callback to run cleanup
    expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
    socketCallbacks['close']();
    expect(mockLogger.off).toHaveBeenCalledWith('data', expect.any(Function));
  });

  it('should follow running workflow logs and cleanup when workflow finishes', async () => {
    const logsRequest = Buffer.from(JSON.stringify({
      command: 'logs',
      args: { name: 'wf-name', follow: true }
    }));
    
    const unsubscribeFinish = jest.fn();
    const mockExecutor = {
      status: 'Running',
      onFinished: jest.fn().mockReturnValue(unsubscribeFinish)
    };
    mockWorkflowManager.getExecutor.mockReturnValue(mockExecutor);
    mockWorkflowManager.getLogs.mockReturnValue({ content: 'initial log' });

    await handler.handleConnection(mockSocket, logsRequest);

    expect(mockWorkflowManager.on).toHaveBeenCalledWith('log', expect.any(Function));

    // Simulate logs coming from workflow manager
    managerCallbacks['log']('wf-name', 'runtime update line');
    expect(mockSocket.write).toHaveBeenLastCalledWith(JSON.stringify({ type: 'log', content: '"runtime update line"' }) + '\n');

    // Simulate logs for OTHER workflow should be ignored
    const lastWriteCallCount = mockSocket.write.mock.calls.length;
    managerCallbacks['log']('other-wf', 'other log line');
    expect(mockSocket.write.mock.calls.length).toBe(lastWriteCallCount);

    // Simulate workflow finishing
    const finishCallback = mockExecutor.onFinished.mock.calls[0][0];
    finishCallback();

    expect(mockWorkflowManager.off).toHaveBeenCalledWith('log', expect.any(Function));
    expect(unsubscribeFinish).toHaveBeenCalled();
    expect(mockSocket.end).toHaveBeenCalled();
  });

  it('should end socket immediately if following logs of a finished workflow', async () => {
    const logsRequest = Buffer.from(JSON.stringify({
      command: 'logs',
      args: { name: 'wf-name', follow: true }
    }));
    const mockExecutor = {
      status: 'Done'
    };
    mockWorkflowManager.getExecutor.mockReturnValue(mockExecutor);

    await handler.handleConnection(mockSocket, logsRequest);

    expect(mockSocket.end).toHaveBeenCalled();
    expect(mockWorkflowManager.on).not.toHaveBeenCalled();
  });

  it('should follow consolidated logs correctly', async () => {
    const logsRequest = Buffer.from(JSON.stringify({
      command: 'logs',
      args: { follow: true }
    }));

    await handler.handleConnection(mockSocket, logsRequest);

    expect(mockWorkflowManager.on).toHaveBeenCalledWith('log', expect.any(Function));
    managerCallbacks['log']('any-wf', 'any log line');
    expect(mockSocket.write).toHaveBeenLastCalledWith(JSON.stringify({ type: 'log', content: '"any log line"' }) + '\n');

    // Trigger error callback to run cleanup
    expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
    socketCallbacks['error'](new Error('connection reset'));
    expect(mockWorkflowManager.off).toHaveBeenCalledWith('log', expect.any(Function));
  });
});
