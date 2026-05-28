import { FileSystemTaskStorage, InMemoryTaskStorage } from '../../../src/daemon/task-storage';
import * as fs from 'node:fs';

jest.mock('node:fs');

describe('FileSystemTaskStorage', () => {
  const filePath = '/path/to/tasks.md';
  let storage: FileSystemTaskStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new FileSystemTaskStorage(filePath);
  });

  it('should check if file exists', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const result = await storage.exists();
    expect(result).toBe(true);
    expect(fs.existsSync).toHaveBeenCalledWith(filePath);
  });

  it('should read file content', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('file-content');
    const result = await storage.read();
    expect(result).toBe('file-content');
    expect(fs.readFileSync).toHaveBeenCalledWith(filePath, 'utf8');
  });

  it('should write file content', async () => {
    const content = 'new-content';
    await storage.write(content);
    expect(fs.writeFileSync).toHaveBeenCalledWith(filePath, content, 'utf-8');
  });
});

describe('InMemoryTaskStorage', () => {
  it('should initialize with or without initial content', async () => {
    const storageEmpty = new InMemoryTaskStorage();
    expect(await storageEmpty.exists()).toBe(false);
    await expect(storageEmpty.read()).rejects.toThrow('File does not exist');

    const storageWithContent = new InMemoryTaskStorage('initial');
    expect(await storageWithContent.exists()).toBe(true);
    expect(await storageWithContent.read()).toBe('initial');
  });

  it('should support write and delete operations', async () => {
    const storage = new InMemoryTaskStorage();
    await storage.write('new-content');
    expect(await storage.exists()).toBe(true);
    expect(await storage.read()).toBe('new-content');

    await storage.delete();
    expect(await storage.exists()).toBe(false);
    await expect(storage.read()).rejects.toThrow('File does not exist');
  });
});
