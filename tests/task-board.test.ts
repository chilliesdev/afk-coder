import * as fs from 'fs';
import * as path from 'path';
import { TaskBoard } from '../src/daemon/task-board';

const TEST_DIR = path.join(__dirname, 'tmp-task-board');
const TASKS_PATH = path.join(TEST_DIR, 'tasks.md');

describe('TaskBoard', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should parse tasks from tasks.md', async () => {
    const content = `- [x] Task 1\n- [ ] Task 2\n- [ ] Task 3`;
    fs.writeFileSync(TASKS_PATH, content);

    const board = new TaskBoard(TASKS_PATH);
    await board.sync();

    const pending = board.getPendingTasks();
    expect(pending).toHaveLength(2);
    expect(pending[0].description).toBe('Task 2');
    expect(pending[1].description).toBe('Task 3');

    const progress = board.getProgress();
    expect(progress.completed).toBe(1);
    expect(progress.total).toBe(3);
    expect(progress.percentage).toBe('33%');
  });

  it('should throw error for empty tasks.md', async () => {
    fs.writeFileSync(TASKS_PATH, '');

    const board = new TaskBoard(TASKS_PATH);
    await expect(board.sync()).rejects.toThrow('No tasks found in tasks.md');
  });

  it('should handle non-existent tasks.md', async () => {
    const board = new TaskBoard(path.join(TEST_DIR, 'non-existent.md'));
    await board.sync();

    expect(board.getPendingTasks()).toHaveLength(0);
    expect(board.getProgress().total).toBe(0);
  });

  it('should identify newly completed tasks', async () => {
    const initialContent = `- [ ] Task 1\n- [ ] Task 2`;
    fs.writeFileSync(TASKS_PATH, initialContent);

    const board = new TaskBoard(TASKS_PATH);
    await board.sync();
    const snapshot1 = board.getTasks();

    // Mark Task 1 as completed
    const updatedContent = `- [x] Task 1\n- [ ] Task 2`;
    fs.writeFileSync(TASKS_PATH, updatedContent);
    await board.sync();

    const newlyCompleted = board.getNewlyCompleted(snapshot1);
    expect(newlyCompleted).toHaveLength(1);
    expect(newlyCompleted[0].description).toBe('Task 1');
  });

  it('should handle malformed tasks.md', async () => {
    const content = `Some random text\n- [ ] Valid Task\nInvalid line\n- [x] Done Task`;
    fs.writeFileSync(TASKS_PATH, content);

    const board = new TaskBoard(TASKS_PATH);
    await board.sync();

    expect(board.getPendingTasks()).toHaveLength(1);
    expect(board.getPendingTasks()[0].description).toBe('Valid Task');
    expect(board.getProgress().total).toBe(2);
  });
});
