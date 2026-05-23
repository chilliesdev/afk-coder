import Docker from 'dockerode';
import { DockerRuntime } from '../src/daemon/runtime-docker';
import { ConfigManager } from '../src/common/config';

export const mockLoadTokens = jest.fn();
export const mockLoadConfig = jest.fn();
export const mockRefreshToken = jest.fn();

jest.mock('dockerode');
jest.mock('../src/common/config', () => ({
  ConfigManager: jest.fn().mockImplementation(() => ({
    loadTokens: mockLoadTokens,
    loadConfig: mockLoadConfig,
    refreshToken: mockRefreshToken
  })),
  TOKENS_PATH: '/mock/tokens.json',
  CONFIG_DIR: '/mock/config'
}));

describe('DockerRuntime Lifecycle', () => {
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
      exec: jest.fn().mockResolvedValue({
        start: jest.fn().mockResolvedValue({
          on: jest.fn((event, cb) => {
            if (event === 'end') {
              setTimeout(cb, 10);
            }
          })
        }),
        inspect: jest.fn().mockResolvedValue({ ExitCode: 0 })
      })
    };

    (Docker.prototype.createContainer as jest.Mock).mockResolvedValue(mockContainer);
    (Docker.prototype.getImage as jest.Mock).mockReturnValue({
      inspect: jest.fn().mockResolvedValue({}),
    });
    mockLoadConfig.mockReturnValue({
      sandbox: {
        image: 'test-image',
        memory: 1024,
        nanoCpus: 1000000000,
      }
    });
    mockLoadTokens.mockReturnValue({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
    });
    mockRefreshToken.mockResolvedValue({});

    runtime = new DockerRuntime();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should start a persistent container with tail -f /dev/null', async () => {
    await runtime.start('./test-dir');
    expect(Docker.prototype.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Cmd: ['tail', '-f', '/dev/null'],
      HostConfig: expect.objectContaining({
        Binds: expect.arrayContaining([expect.stringContaining('test-dir:/app')]),
      }),
    }));
    expect(mockContainer.start).toHaveBeenCalled();
  });

  it('should execute inside persistent container when running a command', async () => {
    await runtime.start('./test-dir');
    
    const mockExecStream = {
      on: jest.fn((event, cb) => {
        if (event === 'data') {
          // Docker multiplexed header + message 'output'
          const header = Buffer.alloc(8);
          header.writeUInt32BE(0x01000000, 0); // stdout
          header.writeUInt32BE(6, 4); // size 6
          cb(Buffer.concat([header, Buffer.from('output')]));
        }
        if (event === 'end') {
          cb();
        }
      })
    };

    const mockExec = {
      start: jest.fn().mockResolvedValue(mockExecStream),
      inspect: jest.fn().mockResolvedValue({ ExitCode: 42 })
    };

    mockContainer.exec.mockResolvedValue(mockExec);

    const handle = await runtime.run('echo hello', './test-dir');
    const result = await handle.wait();

    expect(mockContainer.exec).toHaveBeenCalledWith(expect.objectContaining({
      Cmd: ['bash', '-c', 'echo hello']
    }));
    expect(result.exitCode).toBe(42);
    expect(result.logs).toBe('output');
  });

  it('should stop container and clean up on stop()', async () => {
    await runtime.start('./test-dir');
    await runtime.stop();

    expect(mockContainer.kill).toHaveBeenCalled();
    expect(mockContainer.remove).toHaveBeenCalled();
  });
});
