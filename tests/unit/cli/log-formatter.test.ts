import { LogFormatter } from '../../../src/cli/log-formatter';

describe('LogFormatter', () => {
  let formatter: LogFormatter;

  beforeEach(() => {
    // Force color off for predictable output in tests
    formatter = new LogFormatter({ color: false });
  });

  it('should parse and format a simple info log', () => {
    const line = JSON.stringify({
      timestamp: '2026-05-27T20:48:52.693Z',
      level: 'info',
      message: 'Workflow started',
      workflow: 'test-wf'
    });
    const result = formatter.format(line);
    expect(result).toBe('[2026-05-27 20:48:52] [INFO] [test-wf] Workflow started');
  });

  it('should handle logs with small metadata', () => {
    const line = JSON.stringify({
      timestamp: '2026-05-27T20:48:52.693Z',
      level: 'info',
      message: 'Workflow started',
      workflow: 'test-wf',
      dir: '/tmp/test'
    });
    const result = formatter.format(line);
    expect(result).toBe('[2026-05-27 20:48:52] [INFO] [test-wf] Workflow started { dir: \'/tmp/test\' }');
  });

  it('should handle logs with large metadata', () => {
    const line = JSON.stringify({
      timestamp: '2026-05-27T20:48:52.693Z',
      level: 'error',
      message: 'Something went wrong',
      stack: 'Error: oops\n    at Object.<anonymous> (test.js:1:1)'
    });
    const result = formatter.format(line);
    expect(result).toContain('[2026-05-27 20:48:52] [ERROR] Something went wrong');
    expect(result).toContain('\n  { stack: \'Error: oops\\n    at Object.<anonymous> (test.js:1:1)\' }');
  });

  it('should fallback to raw string for non-json lines', () => {
    const line = 'Some raw log output';
    const result = formatter.format(line);
    expect(result).toBe('Some raw log output');
  });

  it('should respect --raw flag', () => {
    const line = JSON.stringify({ level: 'info', message: 'test' });
    const result = formatter.format(line, { raw: true });
    expect(result).toBe(line);
  });

  it('should respect --json flag', () => {
    const line = JSON.stringify({ level: 'info', message: 'test' });
    const result = formatter.format(line, { json: true });
    expect(JSON.parse(result)).toEqual({ level: 'info', message: 'test' });
  });

  it('should colorize levels if requested', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true
    });
    try {
      const colorFormatter = new LogFormatter({ color: true });
      const line = JSON.stringify({ level: 'error', message: 'fail' });
      const result = colorFormatter.format(line);
      // [ERROR] in red is \u001B[31m[ERROR]\u001B[0m
      expect(result).toContain('\u001B[31m[ERROR]\u001B[0m');
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process.stdout, 'isTTY', originalDescriptor);
      } else {
        delete (process.stdout as any).isTTY;
      }
    }
  });

  describe('TTY Detection', () => {
    let originalIsTTY: boolean | undefined;

    beforeAll(() => {
      originalIsTTY = process.stdout.isTTY;
    });

    afterAll(() => {
      (process.stdout as any).isTTY = originalIsTTY;
    });

    it('should disable colors if stdout is not a TTY and no option provided', () => {
      (process.stdout as any).isTTY = false;
      const formatter = new LogFormatter();
      const line = JSON.stringify({ level: 'error', message: 'fail' });
      const result = formatter.format(line);
      expect(result).not.toContain('\u001B[');
    });

    it('should disable colors if stdout is not a TTY and color option is true (simulating commander default)', () => {
      (process.stdout as any).isTTY = false;
      const formatter = new LogFormatter({ color: true });
      const line = JSON.stringify({ level: 'error', message: 'fail' });
      const result = formatter.format(line);
      
      // THIS IS EXPECTED TO FAIL with current implementation
      expect(result).not.toContain('\u001B[');
    });

    it('should enable colors if stdout is a TTY and no option provided', () => {
      (process.stdout as any).isTTY = true;
      const formatter = new LogFormatter();
      const line = JSON.stringify({ level: 'error', message: 'fail' });
      const result = formatter.format(line);
      expect(result).toContain('\u001B[');
    });
    
    it('should disable colors if color option is false regardless of TTY', () => {
      (process.stdout as any).isTTY = true;
      const formatter = new LogFormatter({ color: false });
      const line = JSON.stringify({ level: 'error', message: 'fail' });
      const result = formatter.format(line);
      expect(result).not.toContain('\u001B[');
    });
  });
});
