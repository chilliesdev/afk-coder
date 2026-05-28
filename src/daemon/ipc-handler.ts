import * as net from 'node:net';
import * as winston from 'winston';
import { WorkflowManager } from './workflow-manager';
import { DaemonResponse, StartWorkflowRequestArgs } from '../common/types';

export class IpcHandler {
  constructor(
    private readonly workflowManager: WorkflowManager,
    private readonly logger: winston.Logger
  ) {}

  async handleConnection(socket: net.Socket, data: Buffer | string): Promise<void> {
    let keepOpen = false;
    let request: any = null;
    try {
      request = JSON.parse(data.toString());
      let response: DaemonResponse = { success: true };

      switch (request.command) {
        case 'init': {
          const initResult = await this.workflowManager.init(request.args, (milestone) => {
            socket.write(JSON.stringify(milestone) + '\n');
          });
          response = { success: initResult.success, message: initResult.error, data: initResult.logs };
          break;
        }
        case 'start': {
          const startArgs = request.args as StartWorkflowRequestArgs;
          const workflow = await this.workflowManager.startWorkflow(startArgs.name, startArgs.dir, {
            configDir: startArgs.configDir,
            isWorktree: startArgs.isWorktree,
            sourceRepo: startArgs.sourceRepo,
            branch: startArgs.branch,
            agent: startArgs.agent,
          });
          response = { success: true, data: workflow };
          break;
        }
        case 'list': {
          response = { success: true, data: this.workflowManager.listWorkflows() };
          break;
        }
        case 'status': {
          const wf = this.workflowManager.getWorkflow(request.args.name);
          if (!wf) {
            response = { success: false, message: `Workflow ${request.args.name} not found` };
            break;
          }
          response = { success: true, data: wf };
          break;
        }
        case 'kill': {
          await this.workflowManager.killWorkflow(request.args.name);
          response = { success: true, message: `Killed ${request.args.name}` };
          break;
        }
        case 'remove': {
          const wf = this.workflowManager.getWorkflow(request.args.name);
          const dir = wf?.dir;
          const isWorktree = wf?.isWorktree;
          await this.workflowManager.removeWorkflow(request.args.name, undefined, request.args.deleteDir);
          response = { success: true, message: `Removed ${request.args.name}`, data: { dir, isWorktree } };
          break;
        }
        case 'logs': {
          const isDaemon = request.args.daemon || request.args.name === 'daemon';
          if (request.args.follow) {
            if (!isDaemon && request.args.name) {
              const executor = this.workflowManager.getExecutor(request.args.name);
              if (!executor) {
                throw new Error(`Workflow ${request.args.name} not found`);
              }
            }

            keepOpen = true;
            socket.write(JSON.stringify({ success: true }) + '\n');
            const initialLogs = this.workflowManager.getLogs(isDaemon ? 'daemon' : request.args.name, {
              tail: request.args.tail ? Number.parseInt(request.args.tail) : 20,
              daemon: isDaemon
            });
            if (initialLogs && initialLogs.content) {
              const lines = initialLogs.content.split('\n');
              for (const line of lines) {
                if (line.trim()) {
                  socket.write(JSON.stringify({ type: 'log', content: line }) + '\n');
                }
              }
            }

            if (isDaemon) {
              const logListener = (info: any) => {
                socket.write(JSON.stringify({ type: 'log', content: JSON.stringify(info) }) + '\n');
              };
              this.logger.on('data', logListener);

              const cleanup = () => {
                this.logger.off('data', logListener);
              };

              socket.on('close', cleanup);
              socket.on('error', cleanup);
            } else if (request.args.name) {
              const executor = this.workflowManager.getExecutor(request.args.name);
              const isRunning = executor &&
                                executor.status !== 'Done' && 
                                executor.status !== 'Killed' && 
                                !executor.status.startsWith('Failed');

              if (isRunning) {
                const logListener = (name: string, info: any) => {
                  if (name === request.args.name) {
                    socket.write(JSON.stringify({ type: 'log', content: JSON.stringify(info) }) + '\n');
                  }
                };
                this.workflowManager.on('log', logListener);

                const unsubscribeFinish = executor.onFinished(() => {
                  cleanup();
                  socket.end();
                });

                const cleanup = () => {
                  this.workflowManager.off('log', logListener);
                  unsubscribeFinish();
                };

                socket.on('close', cleanup);
                socket.on('error', cleanup);
              } else {
                socket.end();
              }
            } else {
              // Consolidated logs follow mode - stream indefinitely from all workflows
              const logListener = (name: string, info: any) => {
                socket.write(JSON.stringify({ type: 'log', content: JSON.stringify(info) }) + '\n');
              };
              this.workflowManager.on('log', logListener);

              const cleanup = () => {
                this.workflowManager.off('log', logListener);
              };

              socket.on('close', cleanup);
              socket.on('error', cleanup);
            }
            break;
          }
          response = { success: true, data: this.workflowManager.getLogs(isDaemon ? 'daemon' : request.args.name, {
            tail: request.args.tail ? Number.parseInt(request.args.tail) : undefined,
            offset: request.args.offset === undefined ? undefined : Number.parseInt(request.args.offset),
            daemon: isDaemon
          }) };
          break;
        }
        default: {
          response = { success: false, message: 'Unknown command' };
        }
      }

      if (!keepOpen) {
        socket.write(JSON.stringify(response) + '\n');
      }
    } catch (error: any) {
      this.logger.error('IPC command execution failed', {
        command: request?.command,
        args: request?.args,
        error: error.message,
        stack: error.stack,
      });
      socket.write(JSON.stringify({ success: false, message: error.message }) + '\n');
      keepOpen = false;
    } finally {
      if (!keepOpen) {
        socket.end();
      }
    }
  }
}
