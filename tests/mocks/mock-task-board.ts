import { Task, TaskBoard as ITaskBoard, TaskBoardState } from '../../src/common/types';

export class MockTaskBoard implements ITaskBoard {
  public tasks: Task[] = [];
  public syncCalled = 0;
  private baseline: Task[] = [];

  async load(): Promise<TaskBoardState> {
    this.syncCalled++;
    this.baseline = this.tasks.map(t => ({ ...t }));
    return this.getState();
  }

  async reconcile(): Promise<{ newlyCompleted: Task[]; state: TaskBoardState }> {
    this.syncCalled++;
    const previousSnapshot = [...this.baseline];
    
    const newlyCompleted = this.tasks.filter(currentTask => {
      if (!currentTask.completed) return false;
      const prevTask = previousSnapshot.find(t => t.description === currentTask.description);
      return !prevTask || !prevTask.completed;
    });

    this.baseline = this.tasks.map(t => ({ ...t }));
    return {
      newlyCompleted,
      state: this.getState()
    };
  }

  getTasks(): Task[] {
    return this.tasks.map(t => ({ ...t }));
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

  private getState(): TaskBoardState {
    const total = this.tasks.length;
    const completed = this.tasks.filter(t => t.completed).length;
    const percentage = total === 0 ? '0%' : `${Math.round((completed / total) * 100)}%`;
    const pendingTasks = this.tasks.filter(t => !t.completed);
    return {
      progress: { completed, total, percentage },
      pendingTasks,
      tasks: this.getTasks()
    };
  }
}
