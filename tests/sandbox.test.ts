import Docker from 'dockerode';
import { Sandbox } from '../src/sandbox';
import * as config from '../src/common/config';

jest.mock('dockerode');
jest.mock('../src/common/config');

describe('Sandbox', () => {
  let sandbox: Sandbox;
  let mockContainer: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContainer = {
      start: jest.fn().mockResolvedValue({}),
      inspect: jest.fn().mockResolvedValue({ State: { Pid: 1234 } }),
      wait: jest.fn().mockResolvedValue({ StatusCode: 0 }),
      logs: jest.fn().mockResolvedValue(Buffer.from([])),
      kill: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
    };

    (Docker.prototype.createContainer as jest.Mock).mockResolvedValue(mockContainer);
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

    sandbox = new Sandbox();
  });

  it('should create and start a container with correct options', async () => {
    const result = await sandbox.runTask('test-workflow', 'test task', './test-dir');

    expect(Docker.prototype.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Image: 'test-image',
      Env: expect.arrayContaining([
        'GOOGLE_ACCESS_TOKEN=test-access',
        'GOOGLE_REFRESH_TOKEN=test-refresh'
      ]),
      HostConfig: expect.objectContaining({
        Memory: 1024,
        NanoCpus: 1000000000,
      }),
    }));
    expect(mockContainer.start).toHaveBeenCalled();
    expect(result.pid).toBe(1234);
  });

  it('should wait for task and return logs', async () => {
    // Docker logs have an 8-byte header
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0x01000000, 0); // stdout
    header.writeUInt32BE(10, 4); // size 10
    const payload = Buffer.from('test logs ');
    
    mockContainer.logs.mockResolvedValue(Buffer.concat([header, payload]));

    const task = await sandbox.runTask('test-workflow', 'test task', './test-dir');
    const result = await task.wait();

    expect(result.exitCode).toBe(0);
    expect(result.logs).toBe('test logs ');
    expect(mockContainer.remove).toHaveBeenCalled();
  });

  it('should handle stop', async () => {
    const task = await sandbox.runTask('test-workflow', 'test task', './test-dir');
    await task.stop();
    expect(mockContainer.kill).toHaveBeenCalled();
    expect(mockContainer.remove).toHaveBeenCalled();
  });
});
