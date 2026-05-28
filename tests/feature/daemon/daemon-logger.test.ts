import * as net from 'node:net';
import * as fs from 'node:fs';
import * as winston from 'winston';
import { ConfigManager } from '../../../src/common/config';

jest.mock('net');
jest.mock('fs');
jest.mock('child_process');
jest.mock('../../../src/common/config', () => {
  const original = jest.requireActual('../../../src/common/config');
  return {
    ...original,
    ConfigManager: jest.fn().mockImplementation(() => ({
      loadConfig: jest.fn().mockReturnValue({
        daemon: {
          socketPath: '/tmp/afk-coder-mock.sock',
          logLevel: 'debug',
          logRotation: {
            maxSize: 50000,
            maxFiles: 10
          }
        }
      })
    })),
    getLogsDir: jest.fn().mockReturnValue('/tmp/mock-daemon-logs')
  };
});

describe('Daemon Logger Initialization', () => {
  let mockServer: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockServer = {
      listen: jest.fn((path, cb) => cb && cb()),
      on: jest.fn(),
    };
    (net.createServer as jest.Mock).mockReturnValue(mockServer);
  });

  it('should initialize daemonLogger with correct configuration', () => {
    let daemonLogger: any;
    
    jest.isolateModules(() => {
      const daemonModule = require('../../../src/daemon/index');
      daemonLogger = daemonModule.daemonLogger;
    });

    expect(daemonLogger).toBeDefined();
    expect(daemonLogger.level).toBe('debug');
    
    // Assert on console transport
    const consoleTransport = daemonLogger.transports.find(
      (t: any) => t.name === 'console' || t.constructor.name === 'Console'
    );
    expect(consoleTransport).toBeDefined();

    // Assert on file transport
    const fileTransport = daemonLogger.transports.find(
      (t: any) => t.name === 'file' || t.constructor.name === 'File'
    );
    expect(fileTransport).toBeDefined();
    expect(fileTransport.filename).toBe('daemon.json.log');
    expect(fileTransport.dirname).toBe('/tmp/mock-daemon-logs');
    expect(fileTransport.maxsize).toBe(50000);
    expect(fileTransport.maxFiles).toBe(10);
    expect(fileTransport.tailable).toBe(true);
  });
});
