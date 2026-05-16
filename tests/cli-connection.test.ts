import * as net from 'net';
import { sendCommand } from '../src/cli/client';

jest.mock('net');

describe('CLI Client Connection Error Handling', () => {
  let mockSocket: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSocket = {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };
    (net.createConnection as jest.Mock).mockReturnValue(mockSocket);
  });

  it('should provide specific advice for ENOENT (daemon not running)', async () => {
    const promise = sendCommand('list');
    
    // Find the 'error' handler and trigger it
    const errorHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'error')[1];
    errorHandler({ code: 'ENOENT' });

    await expect(promise).rejects.toThrow(/Daemon is not running/);
    await expect(promise).rejects.toThrow(/afk-coder-daemon/);
  });

  it('should provide specific advice for ECONNREFUSED (stale socket)', async () => {
    const promise = sendCommand('list');
    
    const errorHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'error')[1];
    errorHandler({ code: 'ECONNREFUSED' });

    await expect(promise).rejects.toThrow(/Connection refused/);
    await expect(promise).rejects.toThrow(/Try restarting the daemon/);
  });

  it('should provide specific advice for EACCES (permission denied)', async () => {
    const promise = sendCommand('list');
    
    const errorHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'error')[1];
    errorHandler({ code: 'EACCES' });

    await expect(promise).rejects.toThrow(/Permission denied/);
    await expect(promise).rejects.toThrow(/Check socket permissions/);
  });

  it('should provide a generic error message for unknown error codes', async () => {
    const promise = sendCommand('list');
    
    const errorHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'error')[1];
    errorHandler({ code: 'UNKNOWN', message: 'Something went wrong' });

    await expect(promise).rejects.toThrow(/Daemon connection error \(UNKNOWN\): Something went wrong/);
  });

  it('should resolve successfully when daemon responds correctly', async () => {
    const mockResponse = { success: true, data: [] };
    const promise = sendCommand('list');

    const connectCallback = (net.createConnection as jest.Mock).mock.calls[0][1];
    connectCallback(); // Simulate connection success

    const dataHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'data')[1];
    dataHandler(Buffer.from(JSON.stringify(mockResponse)));

    const endHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'end')[1];
    endHandler();

    await expect(promise).resolves.toEqual(mockResponse);
  });
});
