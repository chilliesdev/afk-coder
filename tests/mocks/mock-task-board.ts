import { Task, TaskBoard as ITaskBoard } from '../../src/common/types';

export class MockTaskBoard implements ITaskBoard {
  public tasks: Task[] = [];
  public syncCalled = 0;

  async sync(): Promise<void> {
    this.syncCalled++;
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
