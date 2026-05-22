import { Agent } from '../src/daemon/agent';
import { MockRuntime } from './mocks/mock-runtime';
import { AiderAdapter } from '../src/daemon/agent-aider';

describe('Agent', () => {
  let agent: Agent;
  let mockRuntime: MockRuntime;

  beforeEach(() => {
    mockRuntime = new MockRuntime();
    agent = new Agent(mockRuntime);
  });

  it('should run autonomous loop with correct prompt', async () => {
    await agent.runAutonomousLoop('/some/dir');
    expect(mockRuntime.lastPrompt).toContain('gemini --yolo --prompt');
    expect(mockRuntime.lastPrompt).toContain('tasks.md');
    expect(mockRuntime.lastPrompt).toContain('highest priority uncompleted task');
    expect(mockRuntime.lastDir).toBe('/some/dir');
  });

  it('should use AiderAdapter if provided', async () => {
    const aiderAgent = new Agent(mockRuntime, undefined, new AiderAdapter());
    await aiderAgent.runAutonomousLoop('/some/dir');
    expect(mockRuntime.lastPrompt).toContain('aider --yes --message');
    expect(mockRuntime.lastPrompt).toContain('tasks.md');
  });
});
