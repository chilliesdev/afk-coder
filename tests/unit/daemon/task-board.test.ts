import { TaskBoard } from '../../../src/daemon/task-board';
import { InMemoryTaskStorage } from '../../../src/daemon/task-storage';

describe('TaskBoard', () => {
  it('should parse tasks from task storage', async () => {
    const content = `- [x] Task 1\n- [ ] Task 2\n- [ ] Task 3`;
    const storage = new InMemoryTaskStorage(content);
    const board = new TaskBoard(storage);
    const state = await board.load();

    const pending = state.pendingTasks;
    expect(pending).toHaveLength(2);
    expect(pending[0].description).toBe('Task 2');
    expect(pending[1].description).toBe('Task 3');

    const progress = state.progress;
    expect(progress.completed).toBe(1);
    expect(progress.total).toBe(3);
    expect(progress.percentage).toBe('33%');
  });

  it('should throw error for empty task storage', async () => {
    const storage = new InMemoryTaskStorage('');
    const board = new TaskBoard(storage);
    await expect(board.load()).rejects.toThrow('No tasks found in tasks.md');
  });

  it('should handle non-existent task storage', async () => {
    const storage = new InMemoryTaskStorage();
    const board = new TaskBoard(storage);
    const state = await board.load();

    expect(state.pendingTasks).toHaveLength(0);
    expect(state.progress.total).toBe(0);
  });

  it('should identify newly completed tasks', async () => {
    const initialContent = `- [ ] Task 1\n- [ ] Task 2`;
    const storage = new InMemoryTaskStorage(initialContent);
    const board = new TaskBoard(storage);
    await board.load();

    // Mark Task 1 as completed
    const updatedContent = `- [x] Task 1\n- [ ] Task 2`;
    await storage.write(updatedContent);
    const reconciliation = await board.reconcile();

    expect(reconciliation.newlyCompleted).toHaveLength(1);
    expect(reconciliation.newlyCompleted[0].description).toBe('Task 1');
    expect(reconciliation.state.progress.completed).toBe(1);
    expect(reconciliation.state.progress.total).toBe(2);
  });

  it('should handle malformed task storage', async () => {
    const content = `Some random text\n- [ ] Valid Task\nInvalid line\n- [x] Done Task`;
    const storage = new InMemoryTaskStorage(content);
    const board = new TaskBoard(storage);
    const state = await board.load();

    expect(state.pendingTasks).toHaveLength(1);
    expect(state.pendingTasks[0].description).toBe('Valid Task');
    expect(state.progress.total).toBe(2);
  });
});
