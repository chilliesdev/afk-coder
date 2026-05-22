import { TaskValidator } from '../src/common/validation';

describe('Validation', () => {
  let validator: TaskValidator;

  beforeEach(() => {
    validator = new TaskValidator();
  });

  describe('parseTasks', () => {
    it('should correctly parse tasks and their status', () => {
      const content = `
# Project Tasks
- [x] Task 1: Completed
- [ ] Task 2: Pending
- [X] Task 3: Also Completed
- [ ] Task 4: Another Pending
      `;
      const tasks = validator.parseTasks(content);
      expect(tasks).toHaveLength(4);
      expect(tasks[0]).toEqual({ completed: true, description: 'Task 1: Completed' });
      expect(tasks[1]).toEqual({ completed: false, description: 'Task 2: Pending' });
      expect(tasks[2]).toEqual({ completed: true, description: 'Task 3: Also Completed' });
      expect(tasks[3]).toEqual({ completed: false, description: 'Task 4: Another Pending' });
    });

    it('should handle different spacing and case', () => {
      const content = '- [x] Task 1\n- [ ]   Task 2\n- [X] Task 3';
      const tasks = validator.parseTasks(content);
      expect(tasks).toEqual([
        { completed: true, description: 'Task 1' },
        { completed: false, description: 'Task 2' },
        { completed: true, description: 'Task 3' },
      ]);
    });

    it('should handle literal \\n characters', () => {
      const content = '- [ ] Task 1\\n- [ ] Task 2';
      const tasks = validator.parseTasks(content);
      expect(tasks).toEqual([
        { completed: false, description: 'Task 1' },
        { completed: false, description: 'Task 2' },
      ]);
    });
  });

  describe('validateTasks', () => {
    it('should throw error if no tasks found', () => {
      const content = '# Project\nJust some text';
      expect(() => validator.validateTasks(content)).toThrow('No tasks found in tasks.md');
    });

    it('should throw error for invalid task format', () => {
      const content = '- [ ] Valid task\n- [ invalid ] task';
      expect(() => validator.validateTasks(content)).toThrow('Invalid task format');
    });

    it('should not throw for valid tasks', () => {
      const content = '- [ ] Valid task\n- [x] Done task';
      expect(() => validator.validateTasks(content)).not.toThrow();
    });
  });

  describe('validateQATasks', () => {
    it('should not throw if there are no new tasks', () => {
      const prev = [{ completed: true, description: 'Task 1' }];
      const content = '- [x] Task 1';
      expect(() => validator.validateQATasks(content, prev)).not.toThrow();
    });

    it('should throw if a new task is missing PRD tag', () => {
      const prev = [{ completed: true, description: 'Task 1' }];
      const content = '- [x] Task 1\n- [ ] Task 2';
      expect(() => validator.validateQATasks(content, prev)).toThrow('missing a valid PRD reference suffix');
    });

    it('should not throw if new tasks have valid PRD tags', () => {
      const prev = [{ completed: true, description: 'Task 1' }];
      const content = '- [x] Task 1\n- [ ] Task 2 [PRD: Section 4]';
      expect(() => validator.validateQATasks(content, prev)).not.toThrow();
    });
  });
});
