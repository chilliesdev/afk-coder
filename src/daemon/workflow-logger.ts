/* eslint-disable unicorn/prefer-event-target */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as winston from 'winston';
import { ConfigManager, getLogsDir } from '../common/config';

export interface WorkflowLogger extends EventEmitter {
  getOrCreateLogger(name: string, dir: string, configDir?: string): winston.Logger;
  removeLogger(name: string): void;
  getLogs(
    name?: string,
    options?: { tail?: number; offset?: number; daemon?: boolean },
    getWorkflowConfigDir?: (name: string) => string | undefined
  ): { content: string; nextOffset: number };
}

export class DefaultWorkflowLogger extends EventEmitter implements WorkflowLogger {
  private loggers: Map<string, winston.Logger> = new Map();

  constructor(private readonly configManager?: ConfigManager) {
    super();
  }

  getOrCreateLogger(name: string, dir: string, configDir?: string): winston.Logger {
    if (this.loggers.has(name)) {
      return this.loggers.get(name)!;
    }

    const activeConfigManager = this.configManager || new ConfigManager(configDir);
    const config = activeConfigManager.loadConfig();
    const logsDir = getLogsDir(config);

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFile = path.join(logsDir, `${name}.json.log`);

    let maxSize = 10 * 1024 * 1024; // 10MB default
    let maxFiles = 5;

    if (config.daemon?.logRotation?.maxSize !== undefined) {
      const sizeVal = Number(config.daemon.logRotation.maxSize);
      if (!Number.isNaN(sizeVal) && sizeVal >= 0) {
        maxSize = sizeVal;
      }
    }
    if (config.daemon?.logRotation?.maxFiles !== undefined) {
      const filesVal = Number(config.daemon.logRotation.maxFiles);
      if (!Number.isNaN(filesVal) && filesVal >= 0) {
        maxFiles = filesVal;
      }
    }

    const logger = winston.createLogger({
      level: config.daemon?.logLevel || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { workflow: name },
      transports: [
        new winston.transports.File({
          filename: logFile,
          maxsize: maxSize,
          maxFiles: maxFiles,
          tailable: true,
        }),
      ],
    });

    logger.on('data', (info) => {
      this.emit('log', name, info);
    });

    this.loggers.set(name, logger);
    return logger;
  }

  removeLogger(name: string): void {
    this.loggers.delete(name);
  }

  getLogs(
    name?: string,
    options: { tail?: number; offset?: number; daemon?: boolean } = {},
    getWorkflowConfigDir?: (name: string) => string | undefined
  ): { content: string; nextOffset: number } {
    let configDir: string | undefined;
    if (name && name !== 'daemon' && getWorkflowConfigDir) {
      configDir = getWorkflowConfigDir(name);
    }
    const activeConfigManager = this.configManager || new ConfigManager(configDir);
    const config = activeConfigManager.loadConfig();
    const logsDir = getLogsDir(config);

    if (options.daemon || name === 'daemon') {
      const logFile = path.join(logsDir, 'daemon.json.log');
      if (!fs.existsSync(logFile)) {
        return { content: 'No daemon logs found.', nextOffset: 0 };
      }
      return this.readSingleLogFile(logFile, undefined, options);
    }

    if (name) {
      const logFile = path.join(logsDir, `${name}.json.log`);
      if (!fs.existsSync(logFile)) {
        return { content: 'No logs found.', nextOffset: 0 };
      }
      return this.readSingleLogFile(logFile, name, options);
    }

    // Read all workflow log files
    if (!fs.existsSync(logsDir)) {
      return { content: 'No logs found.', nextOffset: 0 };
    }
    const files = fs.readdirSync(logsDir);
    const logFiles = files.filter(f => f.endsWith('.json.log') && f !== 'daemon.json.log');
    if (logFiles.length === 0) {
      return { content: 'No logs found.', nextOffset: 0 };
    }

    const allLines: { line: string; timestamp: number }[] = [];
    for (const file of logFiles) {
      const logFile = path.join(logsDir, file);
      allLines.push(...this.readLogLines(logFile));
    }

    // Sort chronologically by timestamp
    allLines.sort((a, b) => a.timestamp - b.timestamp);

    let resultLines = allLines.map(l => l.line);
    if (options.tail) {
      resultLines = resultLines.slice(-options.tail);
    }

    const content = resultLines.join('\n') + (resultLines.length > 0 ? '\n' : '');
    return { content, nextOffset: allLines.length };
  }

  private readSingleLogFile(
    logFile: string,
    filterName?: string,
    options: { tail?: number; offset?: number } = {}
  ): { content: string; nextOffset: number } {
    const stats = fs.statSync(logFile);
    const filterLogs = (rawContent: string): string => {
      const lines = rawContent.split('\n');
      const filtered = lines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (!filterName) return true;
        try {
          const parsed = JSON.parse(trimmed);
          return parsed.workflow === filterName;
        } catch {
          return trimmed.includes(filterName);
        }
      });
      return filtered.join('\n') + (filtered.length > 0 ? '\n' : '');
    };

    if (options.offset !== undefined) {
      if (options.offset >= stats.size) {
        return { content: '', nextOffset: stats.size };
      }
      const fd = fs.openSync(logFile, 'r');
      const buffer = Buffer.alloc(stats.size - options.offset);
      fs.readSync(fd, buffer, 0, buffer.length, options.offset);
      fs.closeSync(fd);
      const filteredContent = filterLogs(buffer.toString('utf-8'));
      return { content: filteredContent, nextOffset: stats.size };
    }

    const content = fs.readFileSync(logFile, 'utf8');
    const filteredContent = filterLogs(content);
    if (options.tail) {
      const lines = filteredContent.trim().split('\n');
      const filteredLines = filteredContent.trim() ? lines : [];
      return {
        content: filteredLines.slice(-options.tail).join('\n') + (filteredLines.length > 0 ? '\n' : ''),
        nextOffset: stats.size,
      };
    }
    return { content: filteredContent, nextOffset: stats.size };
  }

  private readLogLines(logFile: string, filterName?: string): { line: string; timestamp: number }[] {
    if (!fs.existsSync(logFile)) return [];
    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const rawLines = content.split('\n');
      const parsedLines: { line: string; timestamp: number }[] = [];
      let lastTimestamp = 0;
      for (const rawLine of rawLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        let timestamp = lastTimestamp;
        let isMatch = true;
        try {
          const parsed = JSON.parse(trimmed);
          if (filterName && parsed.workflow !== filterName) {
            isMatch = false;
          }
          if (parsed.timestamp) {
            const date = new Date(parsed.timestamp);
            if (!Number.isNaN(date.getTime())) {
              timestamp = date.getTime();
              lastTimestamp = timestamp;
            }
          }
        } catch {
          if (filterName && !trimmed.includes(filterName)) {
            isMatch = false;
          }
        }
        if (isMatch) {
          parsedLines.push({ line: trimmed, timestamp });
        }
      }
      return parsedLines;
    } catch {
      return [];
    }
  }
}
