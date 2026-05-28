import * as net from 'node:net';
import * as fs from 'node:fs';

jest.mock('node:net');
jest.mock('node:fs');
jest.mock('node:child_process');

const mockLoggerInstance = {
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};
jest.mock('winston', () => ({
  createLogger: jest.fn().mockReturnValue(mockLoggerInstance),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    json: jest.fn(),
    colorize: jest.fn(),
    simple: jest.fn(),
  },
  transports: {
    Console: jest.fn(),
    File: jest.fn(),
  },
}));

jest.mock('../../../src/common/config', () => {
  const original = jest.requireActual('../../../src/common/config');
  return {
    ...original,
    ConfigManager: jest.fn().mockImplementation(() => ({
      loadConfig: jest.fn().mockReturnValue({
        daemon: {
          socketPath: '/tmp/afk-coder-err-test.sock',
          logLevel: 'info',
        }
      })
    })),
    getLogsDir: jest.fn().mockReturnValue('/tmp/mock-err-logs')
  };
});

describe('Daemon Error Capture', () => {
  let daemonLogger: any;
  let mockServer: any;
  let serverErrorListener: Function;
  let connectionCallback: Function;
  let mockSocket: any;
  let socketErrorListener: Function;
  let socketDataListener: Function;
  let processOnSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;
  const processHandlers: Record<string, Function> = {};

  beforeAll(() => {
    processOnSpy = jest.spyOn(process, 'on').mockImplementation((event: any, cb: any) => {
      processHandlers[event] = cb;
      return process;
    });
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: any) => {
      throw new Error(`Process exited with code ${code}`);
    });

    mockServer = {
      listen: jest.fn((path, cb) => cb && cb()),
      on: jest.fn((event, cb) => {
        if (event === 'error') serverErrorListener = cb;
        return mockServer;
      }),
    };

    (net.createServer as jest.Mock).mockImplementation((cb) => {
      connectionCallback = cb;
      return mockServer;
    });

    // Evaluate the daemon module once to bind handlers
    const daemonModule = require('../../../src/daemon/index');
    daemonLogger = daemonModule.daemonLogger;
  });

  afterAll(() => {
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockSocket = {
      on: jest.fn((event, cb) => {
        if (event === 'error') socketErrorListener = cb;
        if (event === 'data') socketDataListener = cb;
        return mockSocket;
      }),
      write: jest.fn(),
      end: jest.fn(),
    };

    loggerErrorSpy = mockLoggerInstance.error;
  });

  afterEach(() => {
  });

  it('should capture and log command routing crashes', async () => {
    // Trigger connection
    connectionCallback(mockSocket);

    // Send malformed data to trigger JSON parse failure inside the try-catch block
    await socketDataListener(Buffer.from('invalid-json{'));

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'IPC command execution failed',
      expect.objectContaining({
        error: expect.any(String),
        stack: expect.any(String),
      })
    );
    expect(mockSocket.write).toHaveBeenCalledWith(
      expect.stringContaining('"success":false')
    );
    expect(mockSocket.end).toHaveBeenCalled();
  });

  it('should capture and log connection-level socket errors', () => {
    connectionCallback(mockSocket);

    const testError = new Error('ECONNRESET');
    (testError as any).code = 'ECONNRESET';
    socketErrorListener(testError);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'IPC socket connection error',
      expect.objectContaining({
        code: 'ECONNRESET',
        message: 'ECONNRESET',
        stack: expect.any(String),
      })
    );
  });

  it('should capture and log server-level errors', () => {
    const testError = new Error('EADDRINUSE');
    (testError as any).code = 'EADDRINUSE';
    serverErrorListener(testError);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Daemon server error',
      expect.objectContaining({
        code: 'EADDRINUSE',
        message: 'EADDRINUSE',
        stack: expect.any(String),
      })
    );
  });

  it('should capture and log uncaught exceptions globally', () => {
    const uncaughtHandler = processHandlers['uncaughtException'];
    expect(uncaughtHandler).toBeDefined();

    const testError = new Error('Uncaught Boom');
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    try {
      uncaughtHandler(testError);
    } catch (err: any) {
      expect(err.message).toBe('Process exited with code 1');
    }

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Uncaught Exception in daemon process',
      expect.objectContaining({
        message: 'Uncaught Boom',
        stack: expect.any(String),
      })
    );
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/afk-coder-err-test.sock');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should capture and log unhandled promise rejections globally', () => {
    const unhandledHandler = processHandlers['unhandledRejection'];
    expect(unhandledHandler).toBeDefined();

    const testError = new Error('Unhandled Promise Boom');
    unhandledHandler(testError);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Unhandled Promise Rejection in daemon process',
      expect.objectContaining({
        reason: 'Unhandled Promise Boom',
        stack: expect.any(String),
      })
    );
  });

  it('should clean up socket and exit on SIGINT and SIGTERM signals', () => {
    const sigintHandler = processHandlers['SIGINT'];
    expect(sigintHandler).toBeDefined();

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    try {
      sigintHandler();
    } catch (err: any) {
      expect(err.message).toBe('Process exited with code undefined');
    }

    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/afk-coder-err-test.sock');
    expect(processExitSpy).toHaveBeenCalled();

    const sigtermHandler = processHandlers['SIGTERM'];
    expect(sigtermHandler).toBeDefined();

    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    try {
      sigtermHandler();
    } catch (err: any) {
      expect(err.message).toBe('Process exited with code undefined');
    }

    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/afk-coder-err-test.sock');
    expect(processExitSpy).toHaveBeenCalled();
  });

  it('should parse --help command line argument and exit', () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'index.js', '--help'];
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    jest.isolateModules(() => {
      try {
        require('../../../src/daemon/index');
      } catch (err: any) {
        expect(err.message).toBe('Process exited with code 0');
      }
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: afk-coder-daemon'));
    expect(processExitSpy).toHaveBeenCalledWith(0);

    process.argv = originalArgv;
    consoleLogSpy.mockRestore();
  });

  it('should parse --socket command line argument to override socket path', () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'index.js', '--socket', '/tmp/override-cli.sock'];

    jest.isolateModules(() => {
      require('../../../src/daemon/index');
    });

    expect(net.createServer).toHaveBeenCalled();
    // Since SOCKET_PATH was overridden, server.listen should be called with override path
    expect(mockServer.listen).toHaveBeenCalledWith('/tmp/override-cli.sock', expect.any(Function));

    process.argv = originalArgv;
  });

  it('should handle permission errors gracefully when unlinking socket path', () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'index.js', '--socket', '/tmp/permission-unlink.sock'];
    
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const permError = new Error('EACCES: permission denied');
    (permError as any).code = 'EACCES';
    (fs.unlinkSync as jest.Mock).mockImplementationOnce(() => {
      throw permError;
    });

    jest.isolateModules(() => {
      try {
        require('../../../src/daemon/index');
      } catch (err: any) {
        expect(err.message).toBe('Process exited with code 1');
      }
    });

    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: EACCES: operation not permitted'));
    expect(processExitSpy).toHaveBeenCalledWith(1);

    process.argv = originalArgv;
  });
});

