import { FileSystem, NodeFileSystem } from '../../../src/common/fs-interface';
import { ConfigManager } from '../../../src/common/config';

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

  it('should delegate to node:fs in NodeFileSystem', () => {
    const nodeFs = new NodeFileSystem();
    // Use existsSync on an obviously invalid path
    expect(nodeFs.existsSync('/non/existent/path/at/all/gemini-mock')).toBe(false);
  });
});
