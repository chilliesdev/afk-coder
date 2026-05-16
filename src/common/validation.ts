import * as fs from 'fs';
import * as path from 'path';

export interface Task {
  completed: boolean;
  description: string;
}

export function parseTasks(content: string): Task[] {
  const lines = content.split('\n');
  return lines
    .filter(line => line.trim().match(/^- \[[ xX]\]/))
    .map(line => {
      const match = line.trim().match(/^- \[[ xX]\]\s*(.+)/);
      return {
        completed: line.includes('[x]') || line.includes('[X]'),
        description: match ? match[1].trim() : '',
      };
    })
    .filter(task => task.description.length > 0);
}

export function validateTasks(content: string) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
  const taskLines = lines.filter(l => l.startsWith('- ['));
  
  if (taskLines.length === 0) {
    throw new Error('No tasks found in tasks.md. Ensure tasks follow the "- [ ] Task description" format.');
  }

  for (const line of taskLines) {
    if (!/^- \[[ xX]\] .+/.test(line)) {
      throw new Error(`Invalid task format: "${line}". Expected "- [ ] Task description" or "- [x] Task description".`);
    }
  }
}

export function validateWorkflowDir(dir: string) {
  const prdPath = path.join(dir, 'PRD.md');
  const tasksPath = path.join(dir, 'tasks.md');

  if (!fs.existsSync(prdPath)) {
    throw new Error(`PRD.md not found in ${dir}`);
  }
  if (!fs.existsSync(tasksPath)) {
    throw new Error(`tasks.md not found in ${dir}`);
  }

  const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
  validateTasks(tasksContent);
  
  const tasks = parseTasks(tasksContent);
  const pendingTasks = tasks.filter(t => !t.completed);

  if (pendingTasks.length === 0) {
    throw new Error(`No pending tasks found in tasks.md in ${dir}`);
  }
  
  return { tasks, pendingTasks };
}
