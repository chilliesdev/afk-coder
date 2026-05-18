import * as fs from 'fs';
import { Task, TaskBoard as ITaskBoard } from '../common/types';
import { parseTasks, validateTasks } from '../common/validation';

export class TaskBoard implements ITaskBoard {
  private tasks: Task[] = [];
  private tasksPath: string;

  constructor(tasksPath: string) {
    this.tasksPath = tasksPath;
  }

  async sync(): Promise<void> {
    if (!fs.existsSync(this.tasksPath)) {
      this.tasks = [];
      return;
    }
    const content = fs.readFileSync(this.tasksPath, 'utf-8');
    validateTasks(content);
    this.tasks = parseTasks(content);
  }

  getPendingTasks(): Task[] {
    return this.tasks.filter(t => !t.completed);
  }

  getNewlyCompleted(previousSnapshot: Task[]): Task[] {
    return this.tasks.filter(currentTask => {
      if (!currentTask.completed) return false;
      const prevTask = previousSnapshot.find(t => t.description === currentTask.description);
      return !prevTask || !prevTask.completed;
    });
  }

  getProgress(): { completed: number; total: number; percentage: string } {
    const total = this.tasks.length;
    const completed = this.tasks.filter(t => t.completed).length;
    const percentage = total === 0 ? '0%' : `${Math.round((completed / total) * 100)}%`;
    return { completed, total, percentage };
  }

  getTasks(): Task[] {
    return this.tasks.map(t => ({ ...t }));
  }
}
