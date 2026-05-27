import { LogFormatter } from '../src/cli/log-formatter';

describe('LogFormatter TTY Detection', () => {
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
