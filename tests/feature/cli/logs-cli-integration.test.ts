const mockSendCommand = jest.fn();

// Mock DaemonClient
jest.mock('../../../src/cli/client', () => {
  return {
    DaemonClient: jest.fn().mockImplementation(() => {
      return {
        sendCommand: mockSendCommand
      };
    })
  };
});

import { program } from '../../../src/cli/index';

describe('afk logs command integration', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  const runCommand = async (args: string[]) => {
    // commander adds 'node' and 'script' as first two args
    await program.parseAsync(['node', 'afk', ...args]);
  };

  it('should format JSON logs correctly by default', async () => {
    const logLine = {
      timestamp: '2026-05-27T20:48:52.000Z',
      level: 'info',
      message: 'Hello world',
      workflow: 'test-wf'
    };
    mockSendCommand.mockResolvedValue({
      success: true,
      data: { content: JSON.stringify(logLine) + '\n', nextOffset: 100 }
    });

    await runCommand(['logs', 'test-wf', '--no-color']);

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('[2026-05-27 20:48:52] [INFO] [test-wf] Hello world\n'));
  });

  it('should show raw JSON when --json is used', async () => {
    const logLine = {
      timestamp: '2026-05-27T20:48:52.000Z',
      level: 'info',
      message: 'Hello world',
      workflow: 'test-wf'
    };
    mockSendCommand.mockResolvedValue({
      success: true,
      data: { content: JSON.stringify(logLine) + '\n', nextOffset: 100 }
    });

    await runCommand(['logs', 'test-wf', '--json']);

    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(logLine) + '\n');
  });

  it('should show raw output when --raw is used', async () => {
    const rawContent = '{"some":"json"}\nNot JSON line\n';
    mockSendCommand.mockResolvedValue({
      success: true,
      data: { content: rawContent, nextOffset: 100 }
    });

    await runCommand(['logs', 'test-wf', '--raw']);

    expect(stdoutSpy).toHaveBeenCalledWith('{"some":"json"}\n');
    expect(stdoutSpy).toHaveBeenCalledWith('Not JSON line\n');
  });

  it('should handle multiple lines and fallback for non-JSON', async () => {
    const content = JSON.stringify({ level: 'info', message: 'line 1' }) + '\n' +
                    'line 2 (not json)\n';
    mockSendCommand.mockResolvedValue({
      success: true,
      data: { content, nextOffset: 100 }
    });

    await runCommand(['logs', 'test-wf', '--no-color']);

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] line 1\n'));
    expect(stdoutSpy).toHaveBeenCalledWith('line 2 (not json)\n');
  });

  it('should call sendCommand with follow option and invoke callback on logs', async () => {
    mockSendCommand.mockImplementation((command, args, onMilestone, onLog) => {
      if (onLog) {
        onLog('{"level":"info","message":"live line 1"}');
        onLog('live line 2 (not json)');
      }
      return Promise.resolve({ success: true });
    });

    await runCommand(['logs', 'test-wf', '--follow', '--no-color']);

    expect(mockSendCommand).toHaveBeenCalledWith(
      'logs',
      { name: 'test-wf', tail: 20, follow: true, daemon: undefined },
      undefined,
      expect.any(Function)
    );
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] live line 1\n'));
    expect(stdoutSpy).toHaveBeenCalledWith('live line 2 (not json)\n');
  });

  it('should request consolidated logs (no workflow specified)', async () => {
    mockSendCommand.mockResolvedValue({
      success: true,
      data: { content: 'consolidated logs\n', nextOffset: 100 }
    });

    await runCommand(['logs']);

    expect(mockSendCommand).toHaveBeenCalledWith('logs', { name: undefined, tail: undefined, daemon: undefined });
    expect(stdoutSpy).toHaveBeenCalledWith('consolidated logs\n');
  });

  it('should request daemon logs when --daemon is specified', async () => {
    mockSendCommand.mockResolvedValue({
      success: true,
      data: { content: 'daemon logs\n', nextOffset: 100 }
    });

    await runCommand(['logs', '--daemon']);

    expect(mockSendCommand).toHaveBeenCalledWith('logs', { name: undefined, tail: undefined, daemon: true });
    expect(stdoutSpy).toHaveBeenCalledWith('daemon logs\n');
  });

  it('should output error when both workflow name and --daemon are specified', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await runCommand(['logs', 'some-workflow', '--daemon']);
    expect(errorSpy).toHaveBeenCalledWith('Error: Cannot specify both a workflow name and --daemon');
    errorSpy.mockRestore();
  });
});
