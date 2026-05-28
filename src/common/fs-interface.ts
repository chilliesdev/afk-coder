import * as fs from 'node:fs';

export interface FileSystem {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, content: string, options?: any): void;
  mkdirSync(path: string, options?: any): void;
  readdirSync(path: string): string[];
  statSync(path: string): { size: number; isDirectory(): boolean };
  openSync(path: string, flags: string): number;
  readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null): number;
  closeSync(fd: number): void;
  rmSync(path: string, options?: any): void;
}

export class NodeFileSystem implements FileSystem {
  existsSync(path: string): boolean {
    return fs.existsSync(path);
  }

  readFileSync(path: string, encoding: 'utf8'): string {
    return fs.readFileSync(path, encoding);
  }

  writeFileSync(path: string, content: string, options?: any): void {
    if (options === undefined) {
      fs.writeFileSync(path, content);
    } else {
      fs.writeFileSync(path, content, options);
    }
  }

  mkdirSync(path: string, options?: any): void {
    if (options === undefined) {
      fs.mkdirSync(path);
    } else {
      fs.mkdirSync(path, options);
    }
  }

  readdirSync(path: string): string[] {
    return fs.readdirSync(path);
  }

  statSync(path: string): { size: number; isDirectory(): boolean } {
    const stats = fs.statSync(path);
    return {
      size: stats.size,
      isDirectory: () => stats.isDirectory()
    };
  }

  openSync(path: string, flags: string): number {
    return fs.openSync(path, flags);
  }

  readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null): number {
    return fs.readSync(fd, buffer, offset, length, position);
  }

  closeSync(fd: number): void {
    fs.closeSync(fd);
  }

  rmSync(path: string, options?: any): void {
    if (options === undefined) {
      fs.rmSync(path);
    } else {
      fs.rmSync(path, options);
    }
  }
}
