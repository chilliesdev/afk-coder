const mockSendCommand = jest.fn();

// Mock DaemonClient
jest.mock('../src/cli/client', () => {
  return {
    DaemonClient: jest.fn().mockImplementation(() => {
      return {
        sendCommand: mockSendCommand
      };
    })
  };
});

import { program } from '../src/cli/index';

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

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('[2026-05-27 20:48:52] [INFO] Hello world\n'));
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
});
