import { GitClient } from '../common/git';
import { ConfigManager } from '../common/config';
import { Agent } from './agent';
import { MilestoneEvent, MILESTONE_STATUS, MILESTONE_TYPE } from '../common/types';
import * as winston from 'winston';

export class WorkflowGitManager {
  private readonly configManager: ConfigManager;

  constructor(
    private readonly git: GitClient,
    private readonly logger: winston.Logger,
    private readonly configDir?: string,
    configManager?: ConfigManager
  ) {
    this.configManager = configManager || new ConfigManager(configDir);
  }

  isAutoCommitEnabled(): boolean {
    try {
      const config = this.configManager.loadConfig();
      return config.git?.autoCommit === true;
    } catch {
      return false;
    }
  }

  async autoCommitTask(taskDescription: string): Promise<void> {
    try {
      this.git.add('.');
      if (this.git.hasChanges()) {
        this.git.commit(`feat: ${taskDescription}`);
        this.logger.info(`Committed changes for task: ${taskDescription}`);
      }
    } catch (error: any) {
      this.logger.warn(`Failed to commit changes for task "${taskDescription}": ${error.message}`);
    }
  }

  async autoCommitCompletion(): Promise<void> {
    try {
      this.git.add('.');
      if (this.git.hasChanges()) {
        this.git.commit('chore: workflow completed successfully');
        this.logger.info('Committed final changes at workflow completion');
      }
    } catch (error: any) {
      this.logger.warn(`Failed to make final commit: ${error.message}`);
    }
  }

  async autoCommitFailure(status: string): Promise<void> {
    try {
      this.git.add('.');
      if (this.git.hasChanges()) {
        this.git.commit(`chore: workflow failed - ${status}`);
        this.logger.info(`Committed changes at workflow failure: ${status}`);
      }
    } catch (error: any) {
      this.logger.warn(`Failed to make failure commit: ${error.message}`);
    }
  }

  async autoCommitFailureWithException(): Promise<void> {
    try {
      this.git.add('.');
      if (this.git.hasChanges()) {
        this.git.commit('chore: workflow failed with exception');
      }
    } catch {
      // Ignore git commit failure
    }
  }

  async autoCommitBeforeRemoval(
    agent: Agent,
    dir: string,
    onMilestone?: (milestone: MilestoneEvent) => void
  ): Promise<void> {
    try {
      this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Checking for uncommitted changes...');
      if (this.git.hasChanges()) {
        this.git.add('.');
        this.git.reset('tasks.md');
        this.git.reset('PRD.md');

        if (this.git.hasStagedChanges()) {
          this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'Generating commit message using AI...');
          const commitMsg = await agent.generateCommitMessage(dir, this.configDir);
          this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, `Committing changes: "${commitMsg}"...`);
          this.git.commit(commitMsg);
        } else {
          this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, 'No other changes to commit.');
        }
      }
    } catch (error: any) {
      this.logger.error(`Failed to auto-commit changes before removing workflow: ${error.message}`);
      this.emitMilestone(onMilestone, MILESTONE_STATUS.INFO, `Skipped auto-commit due to error: ${error.message}`);
    }
  }

  private emitMilestone(
    onMilestone: ((event: MilestoneEvent) => void) | undefined,
    status: any,
    message: string
  ) {
    if (onMilestone) {
      onMilestone({
        type: MILESTONE_TYPE,
        status,
        message,
        timestamp: new Date().toISOString()
      });
    }
  }
}
