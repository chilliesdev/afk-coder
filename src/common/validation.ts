import * as fs from 'node:fs';
import * as path from 'node:path';
import { Task } from './types';

export interface FileSystemReader {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
}

export class TaskValidator {
  constructor(private readonly fsReader: FileSystemReader = fs) {}
  parseTasks(content: string): Task[] {
    // Handle literal \n by replacing it with real newline
    const normalizedContent = content.replaceAll(String.raw`\n`, '\n');
    const lines = normalizedContent.split('\n');
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

  validateTasks(content: string): void {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
    const taskLines = lines.filter(l => l.startsWith('- ['));
    
    if (taskLines.length === 0) {
      throw new Error('No tasks found in tasks.md');
    }

    for (const line of taskLines) {
      if (!/^- \[[ xX]\] .+/.test(line)) {
        throw new Error(`Invalid task format: "${line}". Expected "- [ ] Task description" or "- [x] Task description".`);
      }
    }
  }

  validateWorkflowDir(dir: string): { tasks: Task[]; pendingTasks: Task[] } {
    const prdPath = path.join(dir, 'PRD.md');
    const tasksPath = path.join(dir, 'tasks.md');

    if (!this.fsReader.existsSync(prdPath)) {
      throw new Error(`PRD.md not found in ${dir}`);
    }
    if (!this.fsReader.existsSync(tasksPath)) {
      throw new Error(`tasks.md not found in ${dir}`);
    }

    const tasksContent = this.fsReader.readFileSync(tasksPath, 'utf8');
    this.validateTasks(tasksContent);
    
    const tasks = this.parseTasks(tasksContent);
    const pendingTasks = tasks.filter(t => !t.completed);

    if (pendingTasks.length === 0) {
      throw new Error(`No pending tasks found in tasks.md in ${dir}`);
    }
    
    return { tasks, pendingTasks };
  }

  validateQAParsedTasks(currentTasks: Task[], previousTasks: Task[]): void {
    const newTasks = currentTasks.filter(curr => 
      !previousTasks.some(prev => prev.description === curr.description)
    );

    for (const task of newTasks) {
      if (!/\[PRD:\s*.+\]$/.test(task.description)) {
        throw new Error(`QA-added task "${task.description}" is missing a valid PRD reference suffix (e.g. "[PRD: Section 1.2]").`);
      }
    }
  }

  validateQATasks(content: string, previousTasks: Task[]): void {
    const currentTasks = this.parseTasks(content);
    this.validateQAParsedTasks(currentTasks, previousTasks);
  }
}
