import * as winston from 'winston';
import { TaskBoard as ITaskBoard } from '../common/types';
import { Agent } from './agent';
import { TaskValidator } from '../common/validation';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WorkflowPhaseContext {
  dir: string;
  configDir?: string;
  taskBoard: ITaskBoard;
  agent: Agent;
  logger: winston.Logger;
  qaCycles: number;
  reportTokens: (input: number, output: number) => void;
  reportCompletedTasks: (tasks: import('../common/types').Task[]) => void;
}

export interface WorkflowPhase {
  /**
   * Executes the phase. Returns the name of the next phase to transition to, 
   * or 'Done' / 'Failed: <reason>' to terminate.
   */
  execute(context: WorkflowPhaseContext): Promise<string>;
}

export class CodingPhaseAdapter implements WorkflowPhase {
  async execute(context: WorkflowPhaseContext): Promise<string> {
    const boardState = await context.taskBoard.load();
    const pendingTasks = boardState.pendingTasks;

    if (pendingTasks.length === 0) {
      if (context.qaCycles >= 3) {
        context.logger.warn('Max QA cycles (3) exceeded without passing QA tests');
        return 'Failed: Max QA Cycles Exceeded';
      }
      context.logger.info(`Coding tasks completed. Transitioning to QA Phase (Cycle ${context.qaCycles + 1})`);
      return 'QA';
    }

    const result = await context.agent.executeCodingLoop(context.dir, context.taskBoard, context.configDir, context.logger);
    
    context.reportTokens(result.tokenUsage.input, result.tokenUsage.output);
    
    if (result.success) {
      if (result.newlyCompletedTasks && result.newlyCompletedTasks.length > 0) {
        context.reportCompletedTasks(result.newlyCompletedTasks);
      }
      return 'Coding'; // Continue in this phase
    }

    return `Failed: ${result.error || 'Agent execution failed'}`;
  }
}

export class QaPhaseAdapter implements WorkflowPhase {
  async execute(context: WorkflowPhaseContext): Promise<string> {
    const boardState = await context.taskBoard.load();
    const previousTasks = boardState.tasks;

    const result = await context.agent.executeQALoop(context.dir, context.taskBoard, context.configDir, context.logger);
    
    context.reportTokens(result.tokenUsage.input, result.tokenUsage.output);

    if (!result.success) {
       return `Failed: ${result.error || 'QA Agent execution failed'}`;
    }

    const tasksPath = path.join(context.dir, 'tasks.md');
    if (fs.existsSync(tasksPath)) {
      const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
      const validator = new TaskValidator();
      try {
        validator.validateQATasks(tasksContent, previousTasks);
      } catch (error: any) {
        context.logger.error('QA task validation failed', { error: error.message });
        return `Failed: QA Task Validation Error`;
      }
    }

    const updatedBoardState = await context.taskBoard.load();
    const newPending = updatedBoardState.pendingTasks;
    
    if (newPending.length > 0) {
      context.logger.info('QA Phase found unmet requirements. Transitioning back to Coding Phase.', {
        newTasks: newPending.map(t => t.description)
      });
      return 'Coding';
    }

    context.logger.info('QA Phase passed with no unmet requirements.');
    return 'Done';
  }
}
