import * as fs from 'fs';
import * as path from 'path';
import { Agent } from '../src/daemon/agent';
import { MockRuntime } from './mocks/mock-runtime';

const TEST_DIR = path.resolve('./test-task-generator');

describe('Agent Task Generation', () => {
  let mockRuntime: MockRuntime;
  let agent: Agent;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR);
    mockRuntime = new MockRuntime();
    agent = new Agent(mockRuntime);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should generate tasks.md successfully when PRD is present', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD Content');
    mockRuntime.nextResult = {
      exitCode: 0,
      logs: 'Some logs...'
    };

    // Simulate agent writing to tasks.md
    const originalRun = mockRuntime.run.bind(mockRuntime);
    mockRuntime.run = async (prompt, dir, configDir) => {
      const handle = await originalRun(prompt, dir, configDir);
      const originalWait = handle.wait.bind(handle);
      handle.wait = async () => {
        fs.writeFileSync(path.join(TEST_DIR, 'tasks.md'), '- [ ] Generated Task 1');
        return originalWait();
      };
      return handle;
    };

    const res = await agent.generateTasks(TEST_DIR, 'PRD.md');
    expect(res.success).toBe(true);
    expect(res.logs).toContain('Successfully generated tasks.md');
    expect(fs.readFileSync(path.join(TEST_DIR, 'tasks.md'), 'utf8')).toBe('- [ ] Generated Task 1');
  });

  it('should fall back to parsing stdout if file was left empty', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD Content');
    mockRuntime.nextResult = {
      exitCode: 0,
      logs: 'Logs\n- [ ] Task from stdout 1\n- [ ] Task from stdout 2'
    };

    const res = await agent.generateTasks(TEST_DIR, 'PRD.md');
    expect(res.success).toBe(true);
    expect(res.logs).toContain('from stdout');
    expect(fs.readFileSync(path.join(TEST_DIR, 'tasks.md'), 'utf8')).toBe('- [ ] Task from stdout 1\n- [ ] Task from stdout 2');
  });

  it('should fail and clean up tasks.md if exit code is non-zero and file is empty', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD Content');
    mockRuntime.nextResult = {
      exitCode: 1,
      logs: 'Fatal Sandbox Error'
    };

    const res = await agent.generateTasks(TEST_DIR, 'PRD.md');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Exit code 1');
    expect(fs.existsSync(path.join(TEST_DIR, 'tasks.md'))).toBe(false);
  });

  it('should fail if PRD.md does not exist', async () => {
    const res = await agent.generateTasks(TEST_DIR, 'PRD.md');
    expect(res.success).toBe(false);
    expect(res.error).toContain('PRD.md not found');
  });

  it('should fail if tasks.md already exists and force is false', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD Content');
    fs.writeFileSync(path.join(TEST_DIR, 'tasks.md'), '- [x] Existing Task');

    const res = await agent.generateTasks(TEST_DIR, 'PRD.md', false);
    expect(res.success).toBe(false);
    expect(res.error).toContain('already exists');
    expect(fs.readFileSync(path.join(TEST_DIR, 'tasks.md'), 'utf8')).toBe('- [x] Existing Task');
  });

  it('should overwrite existing tasks.md if force is true', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD Content');
    fs.writeFileSync(path.join(TEST_DIR, 'tasks.md'), '- [x] Existing Task');

    mockRuntime.nextResult = {
      exitCode: 0,
      logs: 'Logs\n- [ ] New Task'
    };

    const res = await agent.generateTasks(TEST_DIR, 'PRD.md', true);
    expect(res.success).toBe(true);
    expect(fs.readFileSync(path.join(TEST_DIR, 'tasks.md'), 'utf8')).toBe('- [ ] New Task');
  });
});
