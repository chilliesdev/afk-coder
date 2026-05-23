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

  it('should cover auth required throw', async () => {
    mockLoadTokens.mockReturnValue(null);
    delete process.env['GEMINI_API_KEY'];
    await expect(runtime.start('./')).rejects.toThrow('Authentication required');
  });

  it('should cover API key only', async () => {
    mockLoadTokens.mockReturnValue(null);
    process.env['GEMINI_API_KEY'] = 'test-key';
    await runtime.start('./');
    expect((runtime as any).container).toBeDefined();
  });

  it('should throw if image inspect fails with non-404', async () => {
    (Docker.prototype.getImage as jest.Mock).mockReturnValue({
      inspect: jest.fn().mockRejectedValue({ statusCode: 500 })
    });
    await expect(runtime.start('./')).rejects.toEqual({ statusCode: 500 });
  });

  it('should throw if pull fails', async () => {
    (Docker.prototype.getImage as jest.Mock).mockReturnValue({
      inspect: jest.fn().mockRejectedValue({ statusCode: 404 })
    });
    jest.spyOn(Docker.prototype, 'pull').mockImplementation(((image: any, cb: any) => {
      cb(new Error('pull error'));
    }) as any);
    await expect(runtime.start('./')).rejects.toThrow('pull error');
  });

  it('should throw if followProgress fails', async () => {
    (Docker.prototype.getImage as jest.Mock).mockReturnValue({
      inspect: jest.fn().mockRejectedValue({ statusCode: 404 })
    });
    (runtime as any).docker.modem = {
      followProgress: jest.fn((stream, onFinished, onProgress) => {
        onFinished(new Error('progress error'));
      })
    };
    jest.spyOn(Docker.prototype, 'pull').mockImplementation(((image: any, cb: any) => {
      cb(null, {});
    }) as any);
    await expect(runtime.start('./')).rejects.toThrow('progress error');
  });

  it('should pull image if not found locally', async () => {
    (Docker.prototype.getImage as jest.Mock).mockReturnValue({
      inspect: jest.fn().mockRejectedValue({ statusCode: 404 })
    });
    (runtime as any).docker.modem = {
      followProgress: jest.fn((stream, onFinished, onProgress) => {
        onProgress({ status: 'Pulling' });
        onProgress({ status: 'Downloading' });
        onProgress({}); // Missing status
        onFinished(null, {});
      })
    };
    jest.spyOn(Docker.prototype, 'pull').mockImplementation(((image: any, cb: any) => {
      cb(null, {});
    }) as any);
    await runtime.start('./');
    expect((runtime as any).container).toBeDefined();
  });

  it('should cover no tokens file existing', async () => {
    mockLoadTokens.mockReturnValue({ access_token: 'test' });
    const fsMod = require('fs');
    jest.spyOn(fsMod, 'existsSync').mockImplementation(((p: any) => {
      if (typeof p === 'string') return !p.includes('tokens.json');
      return true;
    }) as any);
    jest.spyOn(fsMod, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fsMod, 'writeFileSync').mockImplementation(() => undefined);
    jest.spyOn(fsMod, 'mkdtempSync').mockReturnValue('/tmp/test');

    await runtime.start('./');
    expect((runtime as any).container).toBeDefined();
  });

  it('should cover rmSync exception on cleanup', async () => {
    const fsMod = require('fs');
    jest.spyOn(fsMod, 'rmSync').mockImplementation(() => {
      throw new Error('rmSync error');
    });
    await runtime.start('./');
    await runtime.stop();
  });

  it('should catch container remove error gracefully', async () => {
    await runtime.start('./');
    mockContainer.remove.mockRejectedValue(new Error('remove error'));
    await runtime.stop();
  });

  it('should cover copyFileSync when tokens exist in custom configDir', async () => {
    mockLoadTokens.mockReturnValue({ access_token: 'test' });
    const fsMod = require('fs');
    jest.spyOn(fsMod, 'existsSync').mockImplementation(((p: any) => {
      return true;
    }) as any);
    jest.spyOn(fsMod, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fsMod, 'writeFileSync').mockImplementation(() => undefined);
    jest.spyOn(fsMod, 'copyFileSync').mockImplementation(() => undefined);
    jest.spyOn(fsMod, 'mkdtempSync').mockReturnValue('/tmp/test');

    await runtime.start('./', '/custom/config');
    expect((runtime as any).container).toBeDefined();
  });

  it('should pass through GEMINI_CLI_AUTH_METHOD and GEMINI_PROJECT_ID', async () => {
    process.env.GEMINI_API_KEY = 'test';
    process.env.GEMINI_CLI_AUTH_METHOD = 'service-account';
    process.env.GEMINI_PROJECT_ID = 'my-project';

    await runtime.start('./');

    expect(Docker.prototype.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Env: expect.arrayContaining([
        'GEMINI_CLI_AUTH_METHOD=service-account',
        'GEMINI_PROJECT_ID=my-project'
      ])
    }));
  });

  it('should create and start a container with correct options', async () => {
    await runtime.start('./test-dir');

    expect(Docker.prototype.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Cmd: ['tail', '-f', '/dev/null'],
      HostConfig: expect.objectContaining({
        Binds: expect.arrayContaining([expect.stringContaining('test-dir:/app')]),
      }),
    }));
    expect(mockContainer.start).toHaveBeenCalled();
  });

  it('should propagate GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET if present in config', async () => {
    mockLoadConfig.mockReturnValue({
      sandbox: { image: 'test-image' },
      auth: { clientId: 'test-client-id', clientSecret: 'test-client-secret' }
    });

    await runtime.start('./test-dir');

    expect(Docker.prototype.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Env: expect.arrayContaining([
        'GOOGLE_CLIENT_ID=test-client-id',
        'GOOGLE_CLIENT_SECRET=test-client-secret'
      ]),
    }));
  });

  it('should wait for task and return logs', async () => {
    await runtime.start('./test-dir');

    const mockExecStream = {
      on: jest.fn((event, cb) => {
        if (event === 'data') {
          const header = Buffer.alloc(8);
          header.writeUInt32BE(0x01000000, 0); // stdout
          header.writeUInt32BE(10, 4); // size 10
          const payload = Buffer.from('test logs ');
          cb(Buffer.concat([header, payload]));
        }
        if (event === 'end') {
          cb();
        }
      })
    };

    const mockExec = {
      start: jest.fn().mockResolvedValue(mockExecStream),
      inspect: jest.fn().mockResolvedValue({ ExitCode: 0 })
    };

    mockContainer.exec = jest.fn().mockResolvedValue(mockExec);

    const task = await runtime.run('echo hello', './test-dir');
    const result = await task.wait();

    expect(result.exitCode).toBe(0);
    expect(result.logs).toBe('test logs ');
  });

  it('should handle stop', async () => {
    await runtime.start('./test-dir');
    await runtime.stop();
    expect(mockContainer.kill).toHaveBeenCalled();
    expect(mockContainer.remove).toHaveBeenCalled();
  });
});
