import { cleanup, registerCleanupHandlers } from '../../../src/cli/cleanup';

describe('Cleanup', () => {
  let stdoutWriteSpy: jest.SpyInstance;
  let isTTYOriginal: boolean | undefined;
  let processOnSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  const handlers: { [key: string]: Function } = {};

  beforeEach(() => {
    stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    isTTYOriginal = process.stdout.isTTY;

    processOnSpy = jest.spyOn(process, 'on').mockImplementation((event: any, cb: any) => {
      handlers[event] = cb;
      return process;
    });
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: any) => {
      return undefined as never;
    });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', {
      value: isTTYOriginal,
      configurable: true,
      writable: true
    });
  });

  it('should restore cursor if isTTY is true', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true
    });
    cleanup();
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\u001B[?25h');
  });

  it('should not restore cursor if isTTY is false', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
      writable: true
    });
    cleanup();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('should register process signal handlers and exit handler', () => {
    registerCleanupHandlers();
    expect(processOnSpy).toHaveBeenCalledWith('exit', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGHUP', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));

    // Test SIGINT callback
    handlers['SIGINT']();
    expect(processExitSpy).toHaveBeenCalledWith(130);

    // Test SIGTERM callback
    handlers['SIGTERM']();
    expect(processExitSpy).toHaveBeenCalledWith(143);

    // Test SIGHUP callback
    handlers['SIGHUP']();
    expect(processExitSpy).toHaveBeenCalledWith(129);
  });

  it('should handle uncaught exception correctly', () => {
    registerCleanupHandlers();
    const testError = new Error('Test uncaught error');
    
    handlers['uncaughtException'](testError);
    
    expect(consoleErrorSpy).toHaveBeenCalledWith('\n❌ An unexpected error occurred:');
    expect(consoleErrorSpy).toHaveBeenCalledWith(testError);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle unhandled promise rejection correctly', () => {
    registerCleanupHandlers();
    const testReason = 'Test rejection reason';
    
    handlers['unhandledRejection'](testReason);
    
    expect(consoleErrorSpy).toHaveBeenCalledWith('\n❌ An unhandled promise rejection occurred:');
    expect(consoleErrorSpy).toHaveBeenCalledWith(testReason);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
