import { Spinner } from '../../../src/cli/ui';
import * as readline from 'node:readline';

jest.mock('node:readline');

describe('Spinner', () => {
  let stdoutWriteSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    // Mock isTTY
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('should start and stop correctly', () => {
    const spinner = new Spinner('Testing...');
    spinner.start();
    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('\u001B[?25l')); // Hide cursor
    
    spinner.stop('Done', true);
    // Use regex to match symbol and message, ignoring ANSI codes
    const doneCall = stdoutWriteSpy.mock.calls.find(call => /✔.*Done/.test(call[0]));
    expect(doneCall).toBeDefined();
    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('\u001B[?25h')); // Show cursor
  });

  it('should be idempotent on stop', () => {
    const spinner = new Spinner('Testing...');
    spinner.start();
    spinner.stop('Done', true);
    
    const callCountBefore = stdoutWriteSpy.mock.calls.length;
    spinner.stop(); // Should be ignored
    expect(stdoutWriteSpy.mock.calls.length).toBe(callCountBefore);
  });

  it('should handle failure symbol', () => {
    const spinner = new Spinner('Testing...');
    spinner.start();
    spinner.stop('Failed', false);
    const failedCall = stdoutWriteSpy.mock.calls.find(call => /✖.*Failed/.test(call[0]));
    expect(failedCall).toBeDefined();
  });

  it('should work in non-TTY environment', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
    });

    const spinner = new Spinner('Testing...');
    spinner.start();
    expect(consoleLogSpy).toHaveBeenCalledWith('Testing...');
    
    spinner.stop('Done', true);
    expect(consoleLogSpy).toHaveBeenCalledWith('✔ Done');
    
    spinner.stop(); // Should be ignored
    expect(consoleLogSpy).toHaveBeenCalledTimes(2);
  });

  it('should allow restarting after stop', () => {
    const spinner = new Spinner('Step 1');
    spinner.start();
    spinner.stop('Done 1', true);
    
    spinner.start('Step 2');
    spinner.stop('Done 2', true);
    
    const done1Call = stdoutWriteSpy.mock.calls.find(call => call[0].includes('Done 1'));
    const done2Call = stdoutWriteSpy.mock.calls.find(call => call[0].includes('Done 2'));
    
    expect(done1Call).toBeDefined();
    expect(done2Call).toBeDefined();
  });

  it('should be idempotent on start() if already running', () => {
    const spinner = new Spinner('Running...');
    spinner.start();
    const callsBefore = stdoutWriteSpy.mock.calls.length;
    spinner.start('Running again...');
    expect(stdoutWriteSpy.mock.calls.length).toBe(callsBefore);
    spinner.stop();
  });

  it('should support update() to change message and trigger rendering in TTY', () => {
    const spinner = new Spinner('Initial');
    spinner.start();
    spinner.update('Updated');
    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('Updated'));
    spinner.stop();
  });

  it('should support update() to log in non-TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
    });
    const spinner = new Spinner('Initial');
    spinner.start();
    spinner.update('Updated non-TTY');
    expect(consoleLogSpy).toHaveBeenCalledWith('Updated non-TTY');
    spinner.stop();
  });

  it('should advance frames on interval tick', () => {
    jest.useFakeTimers();
    const spinner = new Spinner('Animating');
    spinner.start();
    
    // First render should be frame 0
    expect(stdoutWriteSpy).toHaveBeenCalledWith('⠋ Animating');
    
    // Advance timers by 160ms (2 ticks of 80ms)
    jest.advanceTimersByTime(160);
    // Should render frame 1 (frames = ['⠋', '⠙', ...])
    expect(stdoutWriteSpy).toHaveBeenCalledWith('⠙ Animating');

    spinner.stop();
    jest.useRealTimers();
  });
});

