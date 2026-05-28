import { IpcHandler } from '../../../src/daemon/ipc-handler';
import { WorkflowManager } from '../../../src/daemon/workflow-manager';
import * as net from 'node:net';
import * as winston from 'winston';

describe('IpcHandler', () => {
  let mockWorkflowManager: jest.Mocked<WorkflowManager>;
  let mockLogger: jest.Mocked<winston.Logger>;
  let mockSocket: jest.Mocked<net.Socket>;
  let handler: IpcHandler;

  beforeEach(() => {
    mockWorkflowManager = {
      listWorkflows: jest.fn().mockReturnValue([]),
      getWorkflow: jest.fn(),
      init: jest.fn(),
      startWorkflow: jest.fn(),
      killWorkflow: jest.fn(),
      removeWorkflow: jest.fn(),
    } as any;

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;

    mockSocket = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    handler = new IpcHandler(mockWorkflowManager, mockLogger);
  });

  it('should handle list command correctly', async () => {
    const listRequest = Buffer.from(JSON.stringify({ command: 'list' }));
    await handler.handleConnection(mockSocket, listRequest);

    expect(mockWorkflowManager.listWorkflows).toHaveBeenCalled();
    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('"success":true')
    );
    expect(mockSocket.end).toHaveBeenCalled();
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
});
