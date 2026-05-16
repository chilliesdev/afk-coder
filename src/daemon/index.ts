import * as net from 'net';
import * as fs from 'fs';
import { WorkflowManager } from './workflow-manager';
import { DaemonResponse } from '../common/types';

const SOCKET_PATH = '/tmp/afk-coder.sock';
const workflowManager = new WorkflowManager();

if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

const server = net.createServer((socket) => {
  socket.on('data', async (data) => {
    try {
      const request = JSON.parse(data.toString());
      let response: DaemonResponse;

      switch (request.command) {
        case 'start':
          const workflow = workflowManager.startWorkflow(request.args.name, request.args.dir);
          response = { success: true, data: workflow };
          break;
        case 'list':
          response = { success: true, data: workflowManager.listWorkflows() };
          break;
        case 'kill':
          await workflowManager.killWorkflow(request.args.name);
          response = { success: true, message: `Killed ${request.args.name}` };
          break;
        case 'logs':
          response = { success: true, data: workflowManager.getLogs(request.args.name, {
            tail: request.args.tail ? parseInt(request.args.tail) : undefined,
            offset: request.args.offset !== undefined ? parseInt(request.args.offset) : undefined
          }) };
          break;
        default:
          response = { success: false, message: 'Unknown command' };
      }

      socket.write(JSON.stringify(response));
    } catch (err: any) {
      socket.write(JSON.stringify({ success: false, message: err.message }));
    } finally {
      socket.end();
    }
  });
});

server.listen(SOCKET_PATH, () => {
  console.log(`Daemon listening on ${SOCKET_PATH}`);
  try {
    fs.chmodSync(SOCKET_PATH, '660');
    console.log(`Socket permissions set to 660`);
  } catch (err: any) {
    console.warn(`Failed to set socket permissions: ${err.message}`);
  }
});

process.on('SIGINT', () => {
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
  process.exit();
});

process.on('SIGTERM', () => {
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
  process.exit();
});
