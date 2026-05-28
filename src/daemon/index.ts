import * as net from 'node:net';
import * as fs from 'node:fs';
import * as child_process from 'node:child_process';
import * as path from 'node:path';
import * as winston from 'winston';
import { WorkflowManager, AgentFactory } from './workflow-manager';
import { DaemonResponse, StartWorkflowRequestArgs } from '../common/types';
import { ConfigManager, getLogsDir } from '../common/config';
import { DockerRuntime } from './runtime-docker';
import { Agent } from './agent';
import { TaskValidator } from '../common/validation';
import { TaskBoard } from './task-board';
import { FileSystemTaskStorage } from './task-storage';
import { OutcomeAnalyzer } from './agent-outcome';
import { GeminiAdapter } from './agent-gemini';
import { AiderAdapter } from './agent-aider';
import { AgentAdapterRegistry } from './agent-adapter';
import { IpcHandler } from './ipc-handler';

// Register default adapters
AgentAdapterRegistry.register('gemini', GeminiAdapter);
AgentAdapterRegistry.register('aider', AiderAdapter);

const configManager = new ConfigManager();
const config = configManager.loadConfig();
const validator = new TaskValidator();

// Configure Daemon Logger
const logsDir = getLogsDir(config);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const daemonLogFile = path.join(logsDir, 'daemon.json.log');

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

export const daemonLogger = winston.createLogger({
  level: config.daemon?.logLevel || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'afk-coder-daemon' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({
      filename: daemonLogFile,
      maxsize: maxSize,
      maxFiles: maxFiles,
      tailable: true,
    })
  ]
});

const agentFactory: AgentFactory = (agentName?: string) => {
  const name = agentName || config.daemon?.agent || 'gemini';
  const adapter = AgentAdapterRegistry.get(name);
  const agentRuntime = new DockerRuntime(configManager);
  return new Agent(agentRuntime, new OutcomeAnalyzer(), adapter);
};

const workflowManager = new WorkflowManager(
  agentFactory,
  (p) => new TaskBoard(new FileSystemTaskStorage(p), validator)
);

const ipcHandler = new IpcHandler(workflowManager, daemonLogger);

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
      daemonLogger.error(`Error: ${error.code}: operation not permitted, unlink '${SOCKET_PATH}'`);
      daemonLogger.error('The socket might be owned by another user.');
      daemonLogger.error('Use --socket <path> or AFK_CODER_SOCKET env var to specify a different path.');
      process.exit(1);
    }
    throw error;
  }
}

const server = net.createServer((socket) => {
  socket.on('error', (error: any) => {
    daemonLogger.error('IPC socket connection error', {
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
  });

  socket.on('data', async (data) => {
    await ipcHandler.handleConnection(socket, data);
  });
});

server.on('error', (error: any) => {
  daemonLogger.error('Daemon server error', {
    code: error.code,
    message: error.message,
    stack: error.stack,
  });
});

server.listen(SOCKET_PATH, () => {
  daemonLogger.info(`Daemon listening on ${SOCKET_PATH}`);
  try {
    fs.chmodSync(SOCKET_PATH, '660');
    daemonLogger.info(`Socket permissions set to 660`);

    const socketGroup = config.daemon?.socketGroup;
    if (socketGroup) {
      try {
        // Try to get GID for the group
        const gid = child_process.execSync(`getent group ${socketGroup} | cut -d: -f3`, { encoding: 'utf8' }).trim();
        if (!gid) {
          if (socketGroup === 'afk-coder-users') {
            daemonLogger.info(`Group ${socketGroup} not found. Skipping socket group ownership change (this is expected in development).`);
          } else {
            daemonLogger.warn(`Group ${socketGroup} not found. Skipping socket group ownership change.`);
          }
          return;
        }
        
        const uid = process.getuid ? process.getuid() : 0;
        fs.chownSync(SOCKET_PATH, uid, Number.parseInt(gid));
        daemonLogger.info(`Socket group ownership set to ${socketGroup} (${gid})`);
      } catch (error: any) {
        if (socketGroup === 'afk-coder-users') {
          daemonLogger.info(`Group ${socketGroup} not found or could not be queried. Skipping socket group ownership change.`);
          return;
        }
        daemonLogger.warn(`Failed to set socket group ownership to ${socketGroup}: ${error.message}`);
      }
    }
  } catch (error: any) {
    daemonLogger.warn(`Failed to set socket permissions/ownership: ${error.message}`);
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

process.on('uncaughtException', (error: Error) => {
  daemonLogger.error('Uncaught Exception in daemon process', {
    message: error.message,
    stack: error.stack,
  });
  if (fs.existsSync(SOCKET_PATH)) {
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      // Ignore socket unlink error on crash
    }
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  daemonLogger.error('Unhandled Promise Rejection in daemon process', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
