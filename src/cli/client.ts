import * as net from 'node:net';
import { DaemonResponse, MilestoneEvent } from '../common/types';
import { ConfigManager } from '../common/config';

export class DaemonClient {
  private readonly socketPath: string;

  constructor(socketPath?: string) {
    if (socketPath) {
      this.socketPath = socketPath;
      return;
    }
    const configManager = new ConfigManager();
    const config = configManager.loadConfig();
    this.socketPath = process.env.AFK_CODER_SOCKET || config.daemon?.socketPath || '/tmp/afk-coder.sock';
  }

  async sendCommand(command: string, args: any = {}, onMilestone?: (milestone: MilestoneEvent) => void): Promise<DaemonResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socketPath) {
        reject(new Error('Socket path is not defined.'));
        return;
      }
      const client = net.createConnection(this.socketPath, () => {
        client.write(JSON.stringify({ command, args }));
      });

      let buffer = '';
      let finalResponse: DaemonResponse | undefined;

      client.on('data', (data) => {
        buffer += data.toString();
        let boundary = buffer.indexOf('\n');
        while (boundary !== -1) {
          const line = buffer.substring(0, boundary);
          buffer = buffer.substring(boundary + 1);
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'milestone' && onMilestone) {
                onMilestone(parsed);
              } else {
                finalResponse = parsed;
              }
            } catch {
              // Ignore parse errors for partial lines or logs
            }
          }
          boundary = buffer.indexOf('\n');
        }
      });

      client.on('end', () => {
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.type === 'milestone' && onMilestone) {
              onMilestone(parsed);
            } else {
              finalResponse = parsed;
            }
          } catch {
            // Ignore
          }
        }

        if (finalResponse) {
          resolve(finalResponse);
        } else {
          reject(new Error('No response from daemon'));
        }
      });

      client.on('error', (err: any) => {
        if (err.code === 'ENOENT') {
          reject(new Error(`Daemon is not running. Could not find socket at ${this.socketPath}.\nPlease start it first by running 'afk-coder-daemon'.`));
          return;
        }
        if (err.code === 'ECONNREFUSED') {
          reject(new Error(`Connection refused. The daemon might be frozen or the socket at ${this.socketPath} is stale.\nTry restarting the daemon.`));
          return;
        }
        if (err.code === 'EACCES') {
          reject(new Error(`Permission denied when connecting to ${this.socketPath}.\nCheck socket permissions or run with sufficient privileges.`));
          return;
        }
        reject(new Error(`Daemon connection error (${err.code}): ${err.message}`));
      });
    });
  }
}
