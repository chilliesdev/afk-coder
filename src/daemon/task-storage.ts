import * as fs from 'node:fs';

export interface TaskBoardStorage {
  exists(): Promise<boolean>;
  read(): Promise<string>;
  write(content: string): Promise<void>;
}

export class FileSystemTaskStorage implements TaskBoardStorage {
  constructor(private readonly filePath: string) {}

  async exists(): Promise<boolean> {
    return fs.existsSync(this.filePath);
  }

  async read(): Promise<string> {
    return fs.readFileSync(this.filePath, 'utf8');
  }

  async write(content: string): Promise<void> {
    fs.writeFileSync(this.filePath, content, 'utf-8');
  }
}

export class InMemoryTaskStorage implements TaskBoardStorage {
  private content: string | null = null;
  private fileExists = false;

  constructor(initialContent?: string) {
    if (initialContent !== undefined) {
      this.content = initialContent;
      this.fileExists = true;
    }
  }

  async exists(): Promise<boolean> {
    return this.fileExists;
  }

  async read(): Promise<string> {
    if (!this.fileExists || this.content === null) {
      throw new Error('File does not exist');
    }
    return this.content;
  }

  async write(content: string): Promise<void> {
    this.content = content;
    this.fileExists = true;
  }

  async delete(): Promise<void> {
    this.content = null;
    this.fileExists = false;
  }
}
