import * as net from 'node:net';
import * as fs from 'node:fs';
import * as child_process from 'node:child_process';
import { WorkflowManager } from './workflow-manager';
import { DaemonResponse } from '../common/types';
import { ConfigManager } from '../common/config';
import { DockerRuntime } from './runtime-docker';
import { Agent } from './agent';
import { TaskValidator } from '../common/validation';
import { TaskBoard } from './task-board';
import { FileSystemTaskStorage } from './task-storage';

const configManager = new ConfigManager();
const config = configManager.loadConfig();
const runtime = new DockerRuntime(configManager);
const agent = new Agent(runtime);
const validator = new TaskValidator();
const workflowManager = new WorkflowManager(
  agent,
  (p) => new TaskBoard(new FileSystemTaskStorage(p), validator)
);

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
  } catch (error: any) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      console.error(`Error: ${error.code}: operation not permitted, unlink '${SOCKET_PATH}'`);
      console.error('The socket might be owned by another user.');
      console.error('Use --socket <path> or AFK_CODER_SOCKET env var to specify a different path.');
      process.exit(1);
    }
    throw error;
  }
}

const server = net.createServer((socket) => {
  socket.on('data', async (data) => {
    try {
      const request = JSON.parse(data.toString());
      let response: DaemonResponse;

      switch (request.command) {
        case 'init': {
          const initResult = await agent.generateTasks(request.args.dir, request.args.prd, request.args.force, request.args.configDir);
          response = { success: initResult.success, message: initResult.error, data: initResult.logs };
          break;
        }
        case 'start': {
          const workflow = await workflowManager.startWorkflow(request.args.name, request.args.dir, request.args.configDir);
          response = { success: true, data: workflow };
          break;
        }
        case 'list': {
          response = { success: true, data: workflowManager.listWorkflows() };
          break;
        }
        case 'status': {
          const wf = workflowManager.getWorkflow(request.args.name);
          if (!wf) {
            response = { success: false, message: `Workflow ${request.args.name} not found` };
            break;
          }
          response = { success: true, data: wf };
          break;
        }
        case 'kill': {
          await workflowManager.killWorkflow(request.args.name);
          response = { success: true, message: `Killed ${request.args.name}` };
          break;
        }
        case 'remove': {
          workflowManager.removeWorkflow(request.args.name);
          response = { success: true, message: `Removed ${request.args.name}` };
          break;
        }
        case 'logs': {
          response = { success: true, data: workflowManager.getLogs(request.args.name, {
            tail: request.args.tail ? Number.parseInt(request.args.tail) : undefined,
            offset: request.args.offset === undefined ? undefined : Number.parseInt(request.args.offset)
          }) };
          break;
        }
        default: {
          response = { success: false, message: 'Unknown command' };
        }
      }

      socket.write(JSON.stringify(response));
    } catch (error: any) {
      socket.write(JSON.stringify({ success: false, message: error.message }));
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
        if (!gid) {
          if (socketGroup === 'afk-coder-users') {
            console.log(`Group ${socketGroup} not found. Skipping socket group ownership change (this is expected in development).`);
          } else {
            console.warn(`Group ${socketGroup} not found. Skipping socket group ownership change.`);
          }
          return;
        }
        
        const uid = process.getuid ? process.getuid() : 0;
        fs.chownSync(SOCKET_PATH, uid, Number.parseInt(gid));
        console.log(`Socket group ownership set to ${socketGroup} (${gid})`);
      } catch (error: any) {
        if (socketGroup === 'afk-coder-users') {
          console.log(`Group ${socketGroup} not found or could not be queried. Skipping socket group ownership change.`);
          return;
        }
        console.warn(`Failed to set socket group ownership to ${socketGroup}: ${error.message}`);
      }
    }
  } catch (error: any) {
    console.warn(`Failed to set socket permissions/ownership: ${error.message}`);
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
