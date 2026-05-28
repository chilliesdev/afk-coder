import * as net from 'node:net';
import { DaemonClient } from '../../../src/cli/client';
import { MILESTONE_TYPE, MILESTONE_STATUS } from '../../../src/common/types';

jest.mock('node:net');

describe('DaemonClient NDJSON Streaming', () => {
  let mockSocket: any;
  let client: DaemonClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new DaemonClient('/tmp/test.sock');
    mockSocket = {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    (net.createConnection as jest.Mock).mockReturnValue(mockSocket);
  });

  it('should parse multiple milestones and a final response', async () => {
    const milestones: any[] = [];
    const onMilestone = (m: any) => milestones.push(m);

    const promise = client.sendCommand('test', {}, onMilestone);

    // Get handlers
    const handlers: Record<string, Function> = {};
    mockSocket.on.mock.calls.forEach((call: any) => {
      handlers[call[0]] = call[1];
    });

    // Simulate milestones
    const m1 = { type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting' };
    const m2 = { type: MILESTONE_TYPE, status: MILESTONE_STATUS.COMPLETED, message: 'Done' };
    const response = { success: true, data: 'final' };

    handlers['data'](Buffer.from(JSON.stringify(m1) + '\n'));
    handlers['data'](Buffer.from(JSON.stringify(m2) + '\n'));
    handlers['data'](Buffer.from(JSON.stringify(response) + '\n'));
    handlers['end']();

    const result = await promise;

    expect(milestones).toHaveLength(2);
    expect(milestones[0]).toEqual(m1);
    expect(milestones[1]).toEqual(m2);
    expect(result).toEqual(response);
  });

  it('should handle milestones and response in the same data chunk', async () => {
    const milestones: any[] = [];
    const onMilestone = (m: any) => milestones.push(m);

    const promise = client.sendCommand('test', {}, onMilestone);

    const handlers: Record<string, Function> = {};
    mockSocket.on.mock.calls.forEach((call: any) => {
      handlers[call[0]] = call[1];
    });

    const m1 = { type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting' };
    const response = { success: true };

    handlers['data'](Buffer.from(JSON.stringify(m1) + '\n' + JSON.stringify(response) + '\n'));
    handlers['end']();

    const result = await promise;

    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toEqual(m1);
    expect(result).toEqual(response);
  });

  it('should handle partial data chunks', async () => {
    const milestones: any[] = [];
    const onMilestone = (m: any) => milestones.push(m);

    const promise = client.sendCommand('test', {}, onMilestone);

    const handlers: Record<string, Function> = {};
    mockSocket.on.mock.calls.forEach((call: any) => {
      handlers[call[0]] = call[1];
    });

    const m1 = { type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting' };
    const m1Json = JSON.stringify(m1);
    
    // Send half of m1
    handlers['data'](Buffer.from(m1Json.substring(0, 10)));
    expect(milestones).toHaveLength(0);

    // Send rest of m1 and newline
    handlers['data'](Buffer.from(m1Json.substring(10) + '\n'));
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toEqual(m1);

    const response = { success: true };
    handlers['data'](Buffer.from(JSON.stringify(response) + '\n'));
    handlers['end']();

    const result = await promise;
    expect(result).toEqual(response);
  });

  it('should NOT mistake milestones for final response if onMilestone is not provided', async () => {
    const promise = client.sendCommand('test', {});

    const handlers: Record<string, Function> = {};
    mockSocket.on.mock.calls.forEach((call: any) => {
      handlers[call[0]] = call[1];
    });

    const m1 = { type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting' };
    const response = { success: true };

    handlers['data'](Buffer.from(JSON.stringify(m1) + '\n'));
    handlers['data'](Buffer.from(JSON.stringify(response) + '\n'));
    handlers['end']();

    const result = await promise;
    expect(result).toEqual(response);
  });

  it('should reject if only milestones are sent and onMilestone is not provided', async () => {
    const promise = client.sendCommand('test', {});

    const handlers: Record<string, Function> = {};
    mockSocket.on.mock.calls.forEach((call: any) => {
      handlers[call[0]] = call[1];
    });

    const m1 = { type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting' };

    handlers['data'](Buffer.from(JSON.stringify(m1) + '\n'));
    handlers['end']();

    // This should fail because we shouldn't accept a milestone as the final response
    await expect(promise).rejects.toThrow('No response from daemon');
  });

  it('should handle missing newline at the end of the stream', async () => {
    const promise = client.sendCommand('test', {});

    const handlers: Record<string, Function> = {};
    mockSocket.on.mock.calls.forEach((call: any) => {
      handlers[call[0]] = call[1];
    });

    const response = { success: true };
    handlers['data'](Buffer.from(JSON.stringify(response))); // No newline
    handlers['end']();

    const result = await promise;
    expect(result).toEqual(response);
  });

  it('should ignore malformed JSON lines', async () => {
    const promise = client.sendCommand('test', {});

    const handlers: Record<string, Function> = {};
    mockSocket.on.mock.calls.forEach((call: any) => {
      handlers[call[0]] = call[1];
    });

    const response = { success: true };
    handlers['data'](Buffer.from('not a json\n'));
    handlers['data'](Buffer.from(JSON.stringify(response) + '\n'));
    handlers['end']();

    const result = await promise;
    expect(result).toEqual(response);
  });

  it('should handle non-object JSON values correctly', async () => {
    const promise = client.sendCommand('test', {});

    const handlers: Record<string, Function> = {};
    mockSocket.on.mock.calls.forEach((call: any) => {
      handlers[call[0]] = call[1];
    });

    handlers['data'](Buffer.from('true\n')); // Should be treated as finalResponse
    handlers['data'](Buffer.from('123\n'));  // Should overwrite finalResponse
    handlers['data'](Buffer.from('"final"\n')); // Should overwrite again
    handlers['end']();

    const result = await promise;
    expect(result).toBe('final');
  });

  it('should use the last non-milestone object as the final response', async () => {
    const promise = client.sendCommand('test', {});

    const handlers: Record<string, Function> = {};
    mockSocket.on.mock.calls.forEach((call: any) => {
      handlers[call[0]] = call[1];
    });

    handlers['data'](Buffer.from(JSON.stringify({ success: true, part: 1 }) + '\n'));
    handlers['data'](Buffer.from(JSON.stringify({ success: true, part: 2 }) + '\n'));
    handlers['end']();

    const result = await promise;
    expect(result).toEqual({ success: true, part: 2 });
  });

  it('should handle empty lines or lines with only whitespace', async () => {
    const promise = client.sendCommand('test', {});

    const handlers: Record<string, Function> = {};
    mockSocket.on.mock.calls.forEach((call: any) => {
      handlers[call[0]] = call[1];
    });

    const response = { success: true };
    handlers['data'](Buffer.from('\n  \n\t\n'));
    handlers['data'](Buffer.from(JSON.stringify(response) + '\n'));
    handlers['end']();

    const result = await promise;
    expect(result).toEqual(response);
  });
});
