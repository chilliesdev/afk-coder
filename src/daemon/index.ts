import * as net from 'net';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { WorkflowManager } from './workflow-manager';
import { DaemonResponse } from '../common/types';
import { loadConfig } from '../common/config';
import { DockerRuntime } from './runtime-docker';
import { Agent } from './agent';

const config = loadConfig();
const runtime = new DockerRuntime();
const agent = new Agent(runtime);
const workflowManager = new WorkflowManager(agent);

let SOCKET_PATH = process.env.AFK_CODER_SOCKET || config.daemon?.socketPath;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--socket' && args[i+1]) {
    SOCKET_PATH = args[i+1];
    i++;
  } else if (args[i] === '--help') {
    console.log('Usage: afk-coder-daemon [options]');
    console.log('Options:');
    console.log('  --socket <path>   Override the default socket path');
    console.log('  --help            Show help');
    process.exit(0);
  }
}

if (!SOCKET_PATH) {
  throw new Error('Socket path is not defined in the config. Exiting.');
}

if (fs.existsSync(SOCKET_PATH)) {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch (err: any) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      console.error(`Error: ${err.code}: operation not permitted, unlink '${SOCKET_PATH}'`);
      console.error('The socket might be owned by another user.');
      console.error('Use --socket <path> or AFK_CODER_SOCKET env var to specify a different path.');
      process.exit(1);
    }
    throw err;
  }
}

const server = net.createServer((socket) => {
  socket.on('data', async (data) => {
    try {
      const request = JSON.parse(data.toString());
      let response: DaemonResponse;

      switch (request.command) {
        case 'init':
          const initResult = await agent.generateTasks(request.args.dir, request.args.prd, request.args.force, request.args.configDir);
          response = { success: initResult.success, message: initResult.error, data: initResult.logs };
          break;
        case 'start':
          const workflow = await workflowManager.startWorkflow(request.args.name, request.args.dir, request.args.configDir);
          response = { success: true, data: workflow };
          break;
        case 'list':
          response = { success: true, data: workflowManager.listWorkflows() };
          break;
        case 'status':
          const wf = workflowManager.getWorkflow(request.args.name);
          if (wf) {
            response = { success: true, data: wf };
          } else {
            response = { success: false, message: `Workflow ${request.args.name} not found` };
          }
          break;
        case 'kill':
          await workflowManager.killWorkflow(request.args.name);
          response = { success: true, message: `Killed ${request.args.name}` };
          break;
        case 'remove':
          workflowManager.removeWorkflow(request.args.name);
          response = { success: true, message: `Removed ${request.args.name}` };
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

    const socketGroup = config.daemon?.socketGroup;
    if (socketGroup) {
      try {
        // Try to get GID for the group
        const gid = child_process.execSync(`getent group ${socketGroup} | cut -d: -f3`, { encoding: 'utf8' }).trim();
        if (gid) {
          const uid = process.getuid ? process.getuid() : 0;
          fs.chownSync(SOCKET_PATH, uid, parseInt(gid));
          console.log(`Socket group ownership set to ${socketGroup} (${gid})`);
        } else if (socketGroup === 'afk-coder-users') {
          console.log(`Group ${socketGroup} not found. Skipping socket group ownership change (this is expected in development).`);
        } else {
          console.warn(`Group ${socketGroup} not found. Skipping socket group ownership change.`);
        }
      } catch (err: any) {
        if (socketGroup === 'afk-coder-users') {
          console.log(`Group ${socketGroup} not found or could not be queried. Skipping socket group ownership change.`);
        } else {
          console.warn(`Failed to set socket group ownership to ${socketGroup}: ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`Failed to set socket permissions/ownership: ${err.message}`);
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
