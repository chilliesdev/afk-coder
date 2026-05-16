import * as net from 'net';
import { DaemonResponse } from '../common/types';
import { loadConfig } from '../common/config';

const config = loadConfig();
const SOCKET_PATH = config.daemon?.socketPath || '/tmp/afk-coder.sock';

export async function sendCommand(command: string, args: any = {}): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    if (!SOCKET_PATH) {
      reject(new Error('Socket path is not defined in the config.'));
      return;
    }
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
        reject(new Error(`Daemon is not running. Could not find socket at ${SOCKET_PATH}.\nPlease start it first by running 'afk-coder-daemon'.`));
      } else if (err.code === 'ECONNREFUSED') {
        reject(new Error(`Connection refused. The daemon might be frozen or the socket at ${SOCKET_PATH} is stale.\nTry restarting the daemon.`));
      } else if (err.code === 'EACCES') {
        reject(new Error(`Permission denied when connecting to ${SOCKET_PATH}.\nCheck socket permissions or run with sufficient privileges.`));
      } else {
        reject(new Error(`Daemon connection error (${err.code}): ${err.message}`));
      }
    });
  });
}
