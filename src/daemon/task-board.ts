import { Task, TaskBoard as ITaskBoard, TaskBoardState } from '../common/types';
import { TaskValidator } from '../common/validation';
import { TaskBoardStorage } from './task-storage';

export class TaskBoard implements ITaskBoard {
  private tasks: Task[] = [];
  private baseline: Task[] = [];
  private storage: TaskBoardStorage;
  private validator: TaskValidator;

  constructor(storage: TaskBoardStorage, validator: TaskValidator = new TaskValidator()) {
    this.storage = storage;
    this.validator = validator;
  }

  async load(): Promise<TaskBoardState> {
    await this.sync();
    this.baseline = this.tasks.map(t => ({ ...t }));
    return this.getState();
  }

  async reconcile(): Promise<{ newlyCompleted: Task[]; state: TaskBoardState }> {
    const previousSnapshot = [...this.baseline];
    await this.sync();

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

  private async sync(): Promise<void> {
    if (!(await this.storage.exists())) {
      this.tasks = [];
      return;
    }
    const content = await this.storage.read();
    this.validator.validateTasks(content);
    this.tasks = this.validator.parseTasks(content);
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

