import * as fs from 'node:fs';
import * as path from 'node:path';
import { DefaultWorkflowLogger } from '../../../src/daemon/workflow-logger';
import { FileSystem } from '../../../src/common/fs-interface';

const mockLoadConfig = jest.fn();
jest.mock('../../../src/common/config', () => {
  return {
    ConfigManager: jest.fn().mockImplementation(() => {
      return {
        loadConfig: mockLoadConfig,
      };
    }),
    getLogsDir: jest.fn().mockImplementation((config) => {
      return config?.daemon?.logDir || '/tmp';
    }),
  };
});

describe('DefaultWorkflowLogger', () => {
  const tempDir = path.join(__dirname, 'temp-workflow-logger-test');
  let workflowLogger: DefaultWorkflowLogger;
  let logsDir: string;

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
    logsDir = path.join(tempDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    mockLoadConfig.mockReturnValue({
      daemon: {
        logLevel: 'info',
        logRotation: {
          maxSize: 1024,
          maxFiles: 2
        },
        logDir: logsDir
      }
    });

    workflowLogger = new DefaultWorkflowLogger();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create and cache winston logger instances', () => {
    const logger1 = workflowLogger.getOrCreateLogger('wf1', tempDir);
    const logger2 = workflowLogger.getOrCreateLogger('wf1', tempDir);

    expect(logger1).toBe(logger2);
  });

  it('should read single log files and support tail options', () => {
    // Write fake logs
    const logFile = path.join(logsDir, 'wf2.json.log');
    const logData = [
      JSON.stringify({ timestamp: '2026-05-28T12:00:00.000Z', level: 'info', message: 'First line', workflow: 'wf2' }),
      JSON.stringify({ timestamp: '2026-05-28T12:01:00.000Z', level: 'info', message: 'Second line', workflow: 'wf2' }),
    ].join('\n') + '\n';

    fs.writeFileSync(logFile, logData);

    const result = workflowLogger.getLogs('wf2', { tail: 1 });
    expect(result.content).toContain('Second line');
    expect(result.content).not.toContain('First line');
  });

  it('should aggregate multiple workflow logs in chronological order', () => {
    const logFile1 = path.join(logsDir, 'wf3.json.log');
    const logData1 = [
      JSON.stringify({ timestamp: '2026-05-28T12:00:00.000Z', level: 'info', message: 'wf3 log 1' }),
      JSON.stringify({ timestamp: '2026-05-28T12:02:00.000Z', level: 'info', message: 'wf3 log 2' }),
    ].join('\n') + '\n';
    fs.writeFileSync(logFile1, logData1);

    const logFile2 = path.join(logsDir, 'wf4.json.log');
    const logData2 = [
      JSON.stringify({ timestamp: '2026-05-28T12:01:00.000Z', level: 'info', message: 'wf4 log 1' }),
    ].join('\n') + '\n';
    fs.writeFileSync(logFile2, logData2);

    const result = workflowLogger.getLogs(undefined, {});
    const lines = result.content.trim().split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('wf3 log 1');
    expect(lines[1]).toContain('wf4 log 1');
    expect(lines[2]).toContain('wf3 log 2');
  });

  it('should support offset-based log reading', () => {
    const logFile = path.join(logsDir, 'wf5.json.log');
    const firstLine = JSON.stringify({ timestamp: '2026-05-28T12:00:00.000Z', level: 'info', message: 'Line 1', workflow: 'wf5' }) + '\n';
    const secondLine = JSON.stringify({ timestamp: '2026-05-28T12:01:00.000Z', level: 'info', message: 'Line 2', workflow: 'wf5' }) + '\n';
    
    fs.writeFileSync(logFile, firstLine + secondLine);

    const firstRead = workflowLogger.getLogs('wf5', { offset: 0 });
    expect(firstRead.content).toContain('Line 1');
    expect(firstRead.content).toContain('Line 2');

    const secondRead = workflowLogger.getLogs('wf5', { offset: Buffer.byteLength(firstLine) });
    expect(secondRead.content).not.toContain('Line 1');
    expect(secondRead.content).toContain('Line 2');
  });

  it('should support in-memory log reading using injected FileSystem', () => {
    class MemoryFileSystem implements FileSystem {
      private files = new Map<string, string>();
      existsSync(path: string): boolean { return this.files.has(path); }
      readFileSync(path: string, encoding: 'utf8'): string { return this.files.get(path) || ''; }
      writeFileSync(path: string, content: string): void { this.files.set(path, content); }
      mkdirSync() {}
      readdirSync() { return []; }
      statSync(p: string) { return { size: this.files.get(p)?.length || 0, isDirectory: () => false }; }
      openSync() { return 0; }
      readSync() { return 0; }
      closeSync() {}
      rmSync() {}
    }
    const memFs = new MemoryFileSystem();
    const logger = new DefaultWorkflowLogger(undefined, memFs);
    memFs.writeFileSync(path.join(logsDir, 'wf-mem.json.log'), JSON.stringify({ timestamp: '2026-05-28T12:00:00.000Z', level: 'info', message: 'Hello Memory', workflow: 'wf-mem' }) + '\n');
    const result = logger.getLogs('wf-mem', {});
    expect(result.content).toContain('Hello Memory');
  });
});
