import Docker from 'dockerode';
import { DockerRuntime } from '../src/daemon/runtime-docker';
import * as config from '../src/common/config';

jest.mock('dockerode');
jest.mock('../src/common/config');

describe('DockerRuntime', () => {
  let runtime: DockerRuntime;
  let mockContainer: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    mockContainer = {
      start: jest.fn().mockResolvedValue({}),
      inspect: jest.fn().mockResolvedValue({ State: { Pid: 1234 } }),
      wait: jest.fn().mockResolvedValue({ StatusCode: 0 }),
      logs: jest.fn().mockResolvedValue(Buffer.from([])),
      kill: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
    };

    (Docker.prototype.createContainer as jest.Mock).mockResolvedValue(mockContainer);
    (Docker.prototype.getImage as jest.Mock).mockReturnValue({
      inspect: jest.fn().mockResolvedValue({}),
    });
    (config.loadConfig as jest.Mock).mockReturnValue({
      sandbox: {
        image: 'test-image',
        memory: 1024,
        nanoCpus: 1000000000,
      }
    });
    (config.loadTokens as jest.Mock).mockReturnValue({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
    });
    (config.refreshToken as jest.Mock).mockResolvedValue({});

    runtime = new DockerRuntime();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create and start a container with correct options', async () => {
    const result = await runtime.run('echo hello', './test-dir');

    expect(Docker.prototype.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Cmd: ['bash', '-c', 'echo hello'],
      HostConfig: expect.objectContaining({
        Binds: expect.arrayContaining([expect.stringContaining('test-dir:/app')]),
      }),
    }));
    expect(mockContainer.start).toHaveBeenCalled();
    expect(result.pid).toBe(1234);
    expect(result.prompt).toBe('echo hello');
  });

  it('should propagate GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET if present in config', async () => {
    (config.loadConfig as jest.Mock).mockReturnValue({
      sandbox: { image: 'test-image' },
      auth: { clientId: 'test-client-id', clientSecret: 'test-client-secret' }
    });

    await runtime.run('echo hello', './test-dir');

    expect(Docker.prototype.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Env: expect.arrayContaining([
        'GOOGLE_CLIENT_ID=test-client-id',
        'GOOGLE_CLIENT_SECRET=test-client-secret'
      ]),
    }));
  });

  it('should wait for task and return logs', async () => {
    // Docker logs have an 8-byte header
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0x01000000, 0); // stdout
    header.writeUInt32BE(10, 4); // size 10
    const payload = Buffer.from('test logs ');
    
    mockContainer.logs.mockResolvedValue(Buffer.concat([header, payload]));

    const task = await runtime.run('echo hello', './test-dir');
    const result = await task.wait();

    expect(result.exitCode).toBe(0);
    expect(result.logs).toBe('test logs ');
    expect(mockContainer.remove).toHaveBeenCalled();
  });

  it('should handle stop', async () => {
    const task = await runtime.run('echo hello', './test-dir');
    await task.stop();
    expect(mockContainer.kill).toHaveBeenCalled();
    expect(mockContainer.remove).toHaveBeenCalled();
  });
});
