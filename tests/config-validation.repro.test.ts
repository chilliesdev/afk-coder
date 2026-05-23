import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Config Validation', () => {
  const TEST_CONFIG_DIR = path.join(os.tmpdir(), 'afk-coder-test-validation-' + Math.random().toString(36).substring(7));
  const BIN_PATH = path.resolve(__dirname, '../src/cli/index.ts');
  
  beforeAll(() => {
    if (!fs.existsSync(TEST_CONFIG_DIR)) {
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  const runCli = (args: string, env: any = {}) => {
    try {
      return execSync(`npx ts-node ${BIN_PATH} ${args}`, {
        encoding: 'utf-8',
        env: { ...process.env, HOME: TEST_CONFIG_DIR, ...env }
      });
    } catch (error: any) {
      return error.stdout + error.stderr;
    }
  };

  test('config set should error if sandbox.memory is not a number', () => {
    const output = runCli('config set sandbox.memory not-a-number');
    expect(output).toContain('Error: sandbox.memory must be a number.');
  });

  test('config set should succeed if sandbox.memory is a number', () => {
    const output = runCli('config set sandbox.memory 1024');
    expect(output).toContain('Successfully set "sandbox.memory" to: 1024');
    
    const getOutput = runCli('config get sandbox.memory');
    expect(getOutput.trim()).toBe('1024');
  });

  test('config set should succeed if sandbox.nanoCpus is a number', () => {
    const output = runCli('config set sandbox.nanoCpus 500000000');
    expect(output).toContain('Successfully set "sandbox.nanoCpus" to: 500000000');
    
    const getOutput = runCli('config get sandbox.nanoCpus');
    expect(getOutput.trim()).toBe('500000000');
  });
});
