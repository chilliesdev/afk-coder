import * as net from 'net';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { loadConfig } from '../src/common/config';

jest.mock('net');
jest.mock('fs');
jest.mock('child_process');
jest.mock('../src/common/config');

describe('Daemon Socket Group Ownership', () => {
  let mockServer: any;
  let listenCallback: Function;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockServer = {
      listen: jest.fn((path, cb) => {
        listenCallback = cb;
      }),
      on: jest.fn(),
    };
    (net.createServer as jest.Mock).mockReturnValue(mockServer);
    
    (loadConfig as jest.Mock).mockReturnValue({
      daemon: {
        socketGroup: 'afk-coder-users',
        socketPath: '/tmp/afk-coder.sock'
      }
    });

    // Mock process.getuid if it doesn't exist (e.g. on Windows)
    if (!process.getuid) {
      (process as any).getuid = jest.fn(() => 1000);
    } else {
      jest.spyOn(process, 'getuid').mockReturnValue(1000);
    }
  });

  it('should set socket group ownership when server starts listening', async () => {
    // Re-import index to trigger the logic (it runs on top-level)
    // We need to use a fresh import to ensure the side effects run
    jest.isolateModules(() => {
      require('../src/daemon/index');
    });

    (child_process.execSync as jest.Mock).mockReturnValue('1001');

    // Trigger the listen callback
    listenCallback();

    expect(fs.chmodSync).toHaveBeenCalledWith('/tmp/afk-coder.sock', '660');
    expect(child_process.execSync).toHaveBeenCalledWith(
      expect.stringContaining('getent group afk-coder-users'),
      expect.any(Object)
    );
    expect(fs.chownSync).toHaveBeenCalledWith('/tmp/afk-coder.sock', 1000, 1001);
  });

  it('should handle missing group gracefully', async () => {
    jest.isolateModules(() => {
      require('../src/daemon/index');
    });

    (child_process.execSync as jest.Mock).mockReturnValue('');

    listenCallback();

    expect(fs.chmodSync).toHaveBeenCalled();
    expect(fs.chownSync).not.toHaveBeenCalled();
  });

  it('should handle execSync errors gracefully', async () => {
    jest.isolateModules(() => {
      require('../src/daemon/index');
    });

    (child_process.execSync as jest.Mock).mockImplementation(() => {
      throw new Error('Group not found');
    });

    listenCallback();

    expect(fs.chmodSync).toHaveBeenCalled();
    expect(fs.chownSync).not.toHaveBeenCalled();
  });
});
