import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Config CLI', () => {
  const TEST_CONFIG_DIR = path.join(os.tmpdir(), 'afk-coder-test-config-' + Math.random().toString(36).substring(7));
  const BIN_PATH = path.resolve(__dirname, '../src/cli/index.ts');
  const TS_NODE_BIN = path.resolve(__dirname, '../node_modules/.bin/ts-node');
  
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
      // Set HOME to our temp dir so it uses a fresh config
      const output = execSync(`${TS_NODE_BIN} ${BIN_PATH} ${args}`, {
        encoding: 'utf-8',
        timeout: 20000,
        env: { 
          ...process.env, 
          HOME: TEST_CONFIG_DIR, 
          npm_config_update_notifier: 'false',
          NO_UPDATE_NOTIFIER: '1',
          ...env 
        }
      });
      return output.replace(/\u001b\[[0-9;]*m/g, '');
    } catch (error: any) {
      const output = (error.stdout || '') + (error.stderr || '');
      return output.replace(/\u001b\[[0-9;]*m/g, '');
    }
  };

  test('config show prints default config', () => {
    const output = runCli('config show');
    const config = JSON.parse(output);
    expect(config).toHaveProperty('sandbox');
    expect(config).toHaveProperty('daemon');
    expect(config).toHaveProperty('auth');
  });

  test('config get retrieves values', () => {
    const output = runCli('config get sandbox.image');
    expect(output.trim()).toContain('us-docker.pkg.dev/gemini-code-dev/gemini-cli/sandbox:0.41.0');
  });

  test('config get retrieves nested objects', () => {
    const output = runCli('config get sandbox');
    const sandbox = JSON.parse(output);
    expect(sandbox).toHaveProperty('image');
    expect(sandbox).toHaveProperty('memory');
  });

  test('config get returns error for non-existent keys', () => {
    const output = runCli('config get non.existent.key');
    expect(output).toContain('Error: Configuration key "non.existent.key" not found.');
  });

  test('config set updates values and coerces types', () => {
    runCli('config set sandbox.memory 4294967296');
    const output = runCli('config get sandbox.memory');
    expect(output.trim()).toBe('4294967296');
    
    runCli('config set daemon.agent custom-agent');
    const agentOutput = runCli('config get daemon.agent');
    expect(agentOutput.trim()).toBe('custom-agent');

    runCli('config set auth.scopes "scope1,scope2"');
    const scopesOutput = runCli('config get auth.scopes');
    const scopes = JSON.parse(scopesOutput);
    expect(scopes).toEqual(['scope1', 'scope2']);

    runCli('config set sandbox.privileged true');
    const privilegedOutput = runCli('config get sandbox.privileged');
    expect(privilegedOutput.trim()).toBe('true');
  });

  test('config set supports JSON arrays', () => {
    runCli('config set auth.scopes \'["a", "b"]\'');
    const output = runCli('config get auth.scopes');
    const scopes = JSON.parse(output);
    expect(scopes).toEqual(['a', 'b']);
  });

  test('config edit ensures config file exists', () => {
    // Mock editor to just touch the file or something, but here we just want to see if it starts
    // We can use 'true' as a no-op editor on Linux
    const output = runCli('config edit', { VISUAL: 'true' });
    expect(output).toContain('Opening configuration in true...');
    expect(fs.existsSync(path.join(TEST_CONFIG_DIR, '.config/afk-coder/config.json'))).toBe(true);
  });

  test('config set coerces auth.scopes to array even if a single string is passed', () => {
    runCli('config set auth.scopes single-scope');
    const output = runCli('config get auth.scopes');
    const scopes = JSON.parse(output);
    expect(scopes).toEqual(['single-scope']);
  });

  test('config edit falls back to nano on non-Windows when VISUAL and EDITOR are unset', () => {
    if (process.platform !== 'win32') {
      const output = runCli('config edit', { VISUAL: '', EDITOR: '' });
      expect(output).toContain('Opening configuration in nano...');
    }
  });

  test('config set daemon.logLevel accepts and normalizes valid log levels', () => {
    const output1 = runCli('config set daemon.logLevel debug');
    expect(output1).toContain('Successfully set "daemon.logLevel" to: debug');
    const val1 = runCli('config get daemon.logLevel');
    expect(val1.trim()).toBe('debug');

    const output2 = runCli('config set daemon.logLevel WARN');
    expect(output2).toContain('Successfully set "daemon.logLevel" to: warn');
    const val2 = runCli('config get daemon.logLevel');
    expect(val2.trim()).toBe('warn');
  });

  test('config set daemon.logLevel rejects invalid log levels', () => {
    const output = runCli('config set daemon.logLevel invalid-level');
    expect(output).toContain('Error: daemon.logLevel must be one of: error, warn, info, http, verbose, debug, silly');
  });
});
