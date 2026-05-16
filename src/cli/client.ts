import * as net from 'net';
import { DaemonResponse } from '../common/types';

const SOCKET_PATH = '/tmp/afk-coder.sock';

export async function sendCommand(command: string, args: any = {}): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH, () => {
      client.write(JSON.stringify({ command, args }));
    });

    let responseData = '';
    client.on('data', (data) => {
      responseData += data.toString();
    });

    client.on('end', () => {
      try {
        resolve(JSON.parse(responseData));
      } catch (err) {
        reject(new Error('Failed to parse daemon response'));
      }
    });

    client.on('error', (err: any) => {
      if (err.code === 'ENOENT') {
        reject(new Error('Daemon is not running. Please start it first.'));
      } else {
        reject(err);
      }
    });
  });
}
