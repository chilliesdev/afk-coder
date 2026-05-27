import * as util from 'node:util';

export interface LogLine {
  timestamp?: string;
  level?: string;
  message?: string;
  workflow?: string;
  [key: string]: any;
}

export interface FormatOptions {
  json?: boolean;
  raw?: boolean;
  color?: boolean;
}

export class LogFormatter {
  private readonly useColor: boolean;

  constructor(options: FormatOptions = {}) {
    this.useColor = options.color ?? process.stdout.isTTY;
  }

  private colors = {
    reset: '\u001B[0m',
    cyan: '\u001B[36m',
    green: '\u001B[32m',
    yellow: '\u001B[33m',
    red: '\u001B[31m',
    gray: '\u001B[90m',
  };

  private colorize(text: string, color: keyof typeof this.colors): string {
    if (!this.useColor) return text;
    return `${this.colors[color]}${text}${this.colors.reset}`;
  }

  public format(line: string, options: FormatOptions = {}): string {
    if (options.raw) return line;
    
    const parsed = this.parseLogLine(line);
    if (typeof parsed === 'string') return parsed;

    if (options.json) return JSON.stringify(parsed);

    return this.formatPretty(parsed);
  }

  private parseLogLine(line: string): LogLine | string {
    const trimmed = line.trim();
    if (!trimmed) return line;
    try {
      return JSON.parse(trimmed);
    } catch {
      return line;
    }
  }

  private formatPretty(log: LogLine): string {
    const parts: string[] = [];

    // 1. Timestamp [YYYY-MM-DD HH:mm:ss]
    if (log.timestamp) {
      const date = new Date(log.timestamp);
      if (!isNaN(date.getTime())) {
        const ts = date.toISOString().replace('T', ' ').substring(0, 19);
        parts.push(this.colorize(`[${ts}]`, 'cyan'));
      }
    }

    // 2. Level [INFO], [WARN], [ERROR]
    if (log.level) {
      const level = log.level.toUpperCase();
      let color: keyof typeof this.colors = 'reset';
      if (level === 'INFO') color = 'green';
      else if (level === 'WARN' || level === 'WARNING') color = 'yellow';
      else if (level === 'ERROR') color = 'red';
      
      parts.push(this.colorize(`[${level}]`, color));
    }

    // 3. Message
    if (log.message) {
      parts.push(log.message);
    }

    // 4. Metadata
    const metadata = { ...log };
    delete metadata.timestamp;
    delete metadata.level;
    delete metadata.message;
    delete metadata.workflow;

    if (Object.keys(metadata).length > 0) {
      const metaStr = this.formatMetadata(metadata);
      parts.push(metaStr);
    }

    return parts.join(' ');
  }

  private formatMetadata(metadata: any): string {
    const keys = Object.keys(metadata);
    if (keys.length === 0) return '';

    // If it's a small object, show it inline
    const isSmall = JSON.stringify(metadata).length < 60;
    if (isSmall) {
      return this.colorize(util.inspect(metadata, { colors: false, breakLength: Infinity }), 'gray');
    }

    // Otherwise, indented multiline
    const inspected = util.inspect(metadata, { 
        colors: this.useColor, 
        depth: 5,
        breakLength: 80 
    });
    return '\n' + inspected.split('\n').map(l => '  ' + l).join('\n');
  }
}
