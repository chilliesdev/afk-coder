import { LogFormatter } from '../src/cli/log-formatter';

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
    expect(result).toBe('[2026-05-27 20:48:52] [INFO] Workflow started');
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
    expect(result).toBe('[2026-05-27 20:48:52] [INFO] Workflow started { dir: \'/tmp/test\' }');
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
    const originalIsTTY = process.stdout.isTTY;
    (process.stdout as any).isTTY = true;
    try {
      const colorFormatter = new LogFormatter({ color: true });
      const line = JSON.stringify({ level: 'error', message: 'fail' });
      const result = colorFormatter.format(line);
      // [ERROR] in red is \u001B[31m[ERROR]\u001B[0m
      expect(result).toContain('\u001B[31m[ERROR]\u001B[0m');
    } finally {
      (process.stdout as any).isTTY = originalIsTTY;
    }
  });
});
