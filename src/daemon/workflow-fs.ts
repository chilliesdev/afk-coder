import * as fs from 'node:fs';
import * as path from 'node:path';
import { MilestoneEvent, MilestoneStatus } from '../common/types';
import * as winston from 'winston';
import { execSync } from 'node:child_process';
import { ConfigManager } from '../common/config';

export interface WorkflowFileSystem {
  safeMoveSync(src: string, dest: string): void;
  ensureDirectoryWritable(
    dir: string,
    configDir?: string,
    logger?: winston.Logger,
    onMilestone?: (milestone: MilestoneEvent) => void
  ): void;
  deleteDirectory(
    dir: string,
    configDir?: string,
    logger?: winston.Logger,
    onMilestone?: (milestone: MilestoneEvent) => void
  ): void;
  exists(path: string): boolean;
  mkdir(path: string, options?: { recursive?: boolean }): void;
  copyFile(src: string, dest: string): void;
  removeFile(path: string): void;
}

export class DefaultWorkflowFileSystem implements WorkflowFileSystem {
  constructor(private readonly configManager?: ConfigManager) {}

  safeMoveSync(src: string, dest: string): void {
    try {
      fs.renameSync(src, dest);
    } catch (error: any) {
      if (error.code === 'EXDEV') {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      } else {
        throw error;
      }
    }
  }

  ensureDirectoryWritable(
    dir: string,
    configDir?: string,
    logger?: winston.Logger,
    onMilestone?: (milestone: MilestoneEvent) => void
  ): void {
    try {
      const uid = process.getuid ? process.getuid() : 1000;
      const gid = process.getgid ? process.getgid() : 1000;

      const activeConfigManager = this.configManager || new ConfigManager(configDir);
      const config = activeConfigManager.loadConfig();
      const image = config.sandbox?.image || 'us-docker.pkg.dev/gemini-code-dev/gemini-cli/sandbox:0.41.0';

      this.emitMilestone(onMilestone, 'info', 'Fixing worktree directory permissions using Docker...');
      
      const resolvedDir = path.resolve(dir);
      const parentDir = path.dirname(resolvedDir);
      const baseName = path.basename(resolvedDir);

      execSync(
        `docker run --rm -v "${parentDir}:/workspace" -w /workspace ${image} chown -R ${uid}:${gid} "${baseName}"`,
        { stdio: 'ignore' }
      );
    } catch (error: any) {
      logger?.error(`Failed to change directory permissions via Docker: ${error.message}`);
      this.emitMilestone(onMilestone, 'info', `Docker permission fix failed: ${error.message}`);
    }
  }

  deleteDirectory(
    dir: string,
    configDir?: string,
    logger?: winston.Logger,
    onMilestone?: (milestone: MilestoneEvent) => void
  ): void {
    if (!fs.existsSync(dir)) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (fsError: any) {
      logger?.warn(`Initial directory deletion failed: ${fsError.message}. Attempting permission fix...`);
      this.ensureDirectoryWritable(dir, configDir, logger, onMilestone);
      this.emitMilestone(onMilestone, 'info', 'Retrying directory deletion...');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  exists(path: string): boolean {
    return fs.existsSync(path);
  }

  mkdir(path: string, options?: { recursive?: boolean }): void {
    fs.mkdirSync(path, options);
  }

  copyFile(src: string, dest: string): void {
    fs.copyFileSync(src, dest);
  }

  removeFile(path: string): void {
    if (fs.existsSync(path)) {
      const stats = fs.statSync(path);
      if (stats.isDirectory()) {
        fs.rmSync(path, { recursive: true, force: true });
      } else {
        fs.rmSync(path, { force: true });
      }
    }
  }

  private emitMilestone(
    onMilestone: ((event: MilestoneEvent) => void) | undefined,
    status: MilestoneStatus,
    message: string
  ) {
    if (onMilestone) {
      onMilestone({
        type: 'milestone',
        status,
        message,
        timestamp: new Date().toISOString()
      });
    }
  }
}
