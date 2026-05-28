import { FileSystem, NodeFileSystem } from '../../../src/common/fs-interface';
import { ConfigManager } from '../../../src/common/config';
jest.mock('node:fs');
import * as fs from 'node:fs';

class MockFileSystem implements FileSystem {
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  readFileSync(path: string, encoding: 'utf8'): string {
    if (!this.files.has(path)) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return this.files.get(path)!;
  }

  writeFileSync(path: string, content: string, options?: any): void {
    this.files.set(path, content);
  }

  mkdirSync(path: string, options?: any): void {
    this.dirs.add(path);
  }

  readdirSync(path: string): string[] {
    return Array.from(this.files.keys())
      .filter(k => k.startsWith(path))
      .map(k => k.replace(path, '').replace(/^\//, ''));
  }

  statSync(path: string): { size: number; isDirectory(): boolean } {
    if (this.dirs.has(path)) {
      return { size: 0, isDirectory: () => true };
    }
    if (this.files.has(path)) {
      return { size: this.files.get(path)!.length, isDirectory: () => false };
    }
    throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
  }

  openSync(path: string, flags: string): number {
    return 1;
  }

  readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null): number {
    return 0;
  }

  closeSync(fd: number): void {}

  rmSync(path: string, options?: any): void {
    this.files.delete(path);
    this.dirs.delete(path);
  }
}

describe('FileSystem DIP & Testability', () => {
  it('should support in-memory ConfigManager operations via injected FileSystem', () => {
    const mockFs = new MockFileSystem();
    const configManager = new ConfigManager('/mock/config/dir', mockFs);

    // Initial state: no config file exists, should return default config
    const initialConfig = configManager.loadConfig();
    expect(initialConfig).toBeDefined();
    expect(initialConfig.sandbox.image).toContain('gemini-cli/sandbox');

    // Save customized config in memory
    const customConfig = {
      ...initialConfig,
      sandbox: {
        ...initialConfig.sandbox,
        image: 'custom-in-memory-image'
      }
    };
    configManager.saveConfig(customConfig);

    // Verify config is saved in memory
    expect(mockFs.existsSync('/mock/config/dir/config.json')).toBe(true);

    // Load back and assert
    const loadedConfig = configManager.loadConfig();
    expect(loadedConfig.sandbox.image).toBe('custom-in-memory-image');
  });

  describe('NodeFileSystem delegation', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('content');
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
      (fs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
      (fs.readdirSync as jest.Mock).mockReturnValue(['file.txt'] as any);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 100, isDirectory: () => true } as any);
      (fs.openSync as jest.Mock).mockReturnValue(9);
      (fs.readSync as jest.Mock).mockReturnValue(10);
      (fs.closeSync as jest.Mock).mockImplementation(() => {});
      (fs.rmSync as jest.Mock).mockImplementation(() => {});
    });

    afterEach(() => {
    });

    it('should delegate all fs operations correctly', () => {
      const nodeFs = new NodeFileSystem();

      expect(nodeFs.existsSync('path')).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith('path');

      expect(nodeFs.readFileSync('path', 'utf8')).toBe('content');
      expect(fs.readFileSync).toHaveBeenCalledWith('path', 'utf8');

      // writeFileSync with and without options
      nodeFs.writeFileSync('path', 'content');
      expect(fs.writeFileSync).toHaveBeenLastCalledWith('path', 'content');
      nodeFs.writeFileSync('path', 'content', { mode: 0o666 });
      expect(fs.writeFileSync).toHaveBeenLastCalledWith('path', 'content', { mode: 0o666 });

      // mkdirSync with and without options
      nodeFs.mkdirSync('path');
      expect(fs.mkdirSync).toHaveBeenLastCalledWith('path');
      nodeFs.mkdirSync('path', { recursive: true });
      expect(fs.mkdirSync).toHaveBeenLastCalledWith('path', { recursive: true });

      expect(nodeFs.readdirSync('path')).toEqual(['file.txt']);
      expect(fs.readdirSync).toHaveBeenCalledWith('path');

      const stat = nodeFs.statSync('path');
      expect(stat.size).toBe(100);
      expect(stat.isDirectory()).toBe(true);
      expect(fs.statSync).toHaveBeenCalledWith('path');

      expect(nodeFs.openSync('path', 'r')).toBe(9);
      expect(fs.openSync).toHaveBeenCalledWith('path', 'r');

      const buf = Buffer.alloc(10);
      expect(nodeFs.readSync(9, buf, 0, 10, null)).toBe(10);
      expect(fs.readSync).toHaveBeenCalledWith(9, buf, 0, 10, null);

      nodeFs.closeSync(9);
      expect(fs.closeSync).toHaveBeenCalledWith(9);

      // rmSync with and without options
      nodeFs.rmSync('path');
      expect(fs.rmSync).toHaveBeenLastCalledWith('path');
      nodeFs.rmSync('path', { recursive: true });
      expect(fs.rmSync).toHaveBeenLastCalledWith('path', { recursive: true });
    });
  });
});

