import { MockRuntime } from './mocks/mock-runtime';

describe('MockRuntime', () => {
  it('should store the last prompt and directory', async () => {
    const runtime = new MockRuntime();
    const handle = await runtime.run('test prompt', '/test/dir');
    
    expect(runtime.lastPrompt).toBe('test prompt');
    expect(runtime.lastDir).toBe('/test/dir');
    expect(runtime.isRunning).toBe(true);
    
    await handle.wait();
    expect(runtime.isRunning).toBe(false);
  });

  it('should return the configured next result', async () => {
    const runtime = new MockRuntime();
    runtime.nextResult = { exitCode: 1, logs: 'error output' };
    
    const handle = await runtime.run('any', 'any');
    const result = await handle.wait();
    
    expect(result.exitCode).toBe(1);
    expect(result.logs).toBe('error output');
  });

  it('should track when stop is called', async () => {
    const runtime = new MockRuntime();
    const handle = await runtime.run('any', 'any');
    
    await handle.stop();
    expect(runtime.stopCalled).toBe(true);
    expect(runtime.isRunning).toBe(false);
  });

  it('should support artificial delays', async () => {
    const runtime = new MockRuntime();
    runtime.runDelay = 50;
    
    const start = Date.now();
    const handle = await runtime.run('any', 'any');
    const runTime = Date.now() - start;
    expect(runTime).toBeGreaterThanOrEqual(40);
    
    const waitStart = Date.now();
    await handle.wait();
    const waitTime = Date.now() - waitStart;
    expect(waitTime).toBeGreaterThanOrEqual(40);
  });
});
