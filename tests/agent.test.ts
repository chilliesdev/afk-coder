import { Agent } from '../src/daemon/agent';
import { MockRuntime } from './mocks/mock-runtime';

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
});
